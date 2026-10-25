export interface SimpleCommand {
  readonly env: Readonly<Record<string, string>>;
  readonly argv: readonly string[];
  readonly redirects: readonly string[];
}

const SEPARATORS = new Set([";", "&&", "||", "|", "&", "\n", "|&"]);
const REDIRECT = /^(?:\d*|&)(>>?|<)$/;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const WRAPPERS = new Set(["sudo", "nohup", "time", "command", "exec", "nice", "timeout", "xargs"]);

const operatorAt = (text: string, index: number): string | undefined => {
  const two = text.slice(index, index + 2);
  if (two === "&&" || two === "||" || two === ">>" || two === "|&") return two;
  const one = text[index] ?? "";
  return ";|&\n><".includes(one) ? one : undefined;
};

const readQuoted = (text: string, start: number): { readonly value: string; readonly end: number } => {
  const quote = text[start];
  let value = "";
  let index = start + 1;
  for (; index < text.length && text[index] !== quote; index += 1) {
    if (quote === '"' && text[index] === "\\" && index + 1 < text.length) index += 1;
    value += text[index] ?? "";
  }
  return { value, end: index };
};

export const tokenize = (text: string): readonly string[] => {
  const tokens: string[] = [];
  let word: string | undefined;
  const flush = (): void => {
    if (word !== undefined) tokens.push(word);
    word = undefined;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "'" || char === '"') {
      const quoted = readQuoted(text, index);
      word = (word ?? "") + quoted.value;
      index = quoted.end;
    } else if (char === "\\" && index + 1 < text.length) {
      word = (word ?? "") + (text[index + 1] ?? "");
      index += 1;
    } else if (char === " " || char === "\t") flush();
    else {
      const operator = operatorAt(text, index);
      if (operator === undefined) word = (word ?? "") + char;
      else {
        const digits = word !== undefined && /^\d+$/.test(word) && (operator === ">" || operator === ">>");
        if (!digits) flush();
        tokens.push(digits ? `${word ?? ""}${operator}` : operator);
        if (digits) word = undefined;
        index += operator.length - 1;
      }
    }
  }
  flush();
  return tokens;
};

const build = (tokens: readonly string[]): SimpleCommand => {
  const env: Record<string, string> = {};
  const argv: string[] = [];
  const redirects: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const assignment = ASSIGNMENT.exec(token);
    if (REDIRECT.test(token)) {
      redirects.push(tokens[index + 1] ?? "");
      index += 1;
    } else if (argv.length === 0 && assignment !== null) env[assignment[1] ?? ""] = assignment[2] ?? "";
    else argv.push(token);
  }
  return { env, argv, redirects };
};

const unwrap = (command: SimpleCommand, depth: number): readonly SimpleCommand[] => {
  const [head = "", ...rest] = command.argv;
  const name = head.split("/").pop() ?? head;
  if (name === "env") {
    const inner = build(rest.filter((arg) => !arg.startsWith("-")));
    return unwrap(
      { ...inner, env: { ...command.env, ...inner.env }, redirects: [...command.redirects, ...inner.redirects] },
      depth,
    );
  }
  if (WRAPPERS.has(name)) {
    const skip = rest.findIndex((arg) => !arg.startsWith("-") && !/^\d+[smh]?$/.test(arg));
    return skip < 0 ? [command] : unwrap({ ...command, argv: rest.slice(skip) }, depth);
  }
  const script = rest[rest.indexOf("-c") + 1];
  if (SHELLS.has(name) && rest.includes("-c") && script !== undefined && depth < 4) {
    return [
      command,
      ...parseShell(script, depth + 1).map((inner) => ({ ...inner, env: { ...command.env, ...inner.env } })),
    ];
  }
  return [{ ...command, argv: [name, ...rest] }];
};

export const parseShell = (text: string, depth = 0): readonly SimpleCommand[] => {
  const groups: string[][] = [[]];
  for (const token of tokenize(text)) {
    if (SEPARATORS.has(token)) groups.push([]);
    else groups[groups.length - 1]?.push(token);
  }
  return groups.filter((group) => group.length > 0).flatMap((group) => unwrap(build(group), depth));
};
