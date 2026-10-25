const SEPARATORS = /\|\||&&|[|;&\n]/;
const TOKEN = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const OUTPUT_REDIRECT = /^(?:\d|&)?>{1,2}\|?$/;
const OUTPUT_ATTACHED = /^(?:\d|&)?>{1,2}\|?\S/;
const WRAPPERS = new Set(["sudo", "command", "exec", "time", "nice", "nohup", "builtin"]);

export interface Segment {
  readonly program: string;
  readonly args: readonly string[];
  readonly redirectedFrom: readonly string[];
}

const tokensOf = (text: string): string[] =>
  Array.from(text.matchAll(TOKEN), (match) => match[1] ?? match[2] ?? match[3] ?? "");

const splitRedirects = (tokens: readonly string[]): { readonly words: string[]; readonly inputs: string[] } => {
  const words: string[] = [];
  const inputs: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (OUTPUT_REDIRECT.test(token)) {
      index += 1;
    } else if (OUTPUT_ATTACHED.test(token)) {
      continue;
    } else if (token === "<") {
      inputs.push(tokens[index + 1] ?? "");
      index += 1;
    } else if (token.startsWith("<") && !token.startsWith("<<")) {
      inputs.push(token.slice(1));
    } else {
      words.push(token);
    }
  }
  return { words, inputs };
};

const segmentOf = (text: string): Segment | undefined => {
  const { words, inputs } = splitRedirects(tokensOf(text));
  let index = 0;
  while (index < words.length && (ASSIGNMENT.test(words[index] ?? "") || WRAPPERS.has(words[index] ?? ""))) index += 1;
  const program = words[index];
  if (program === undefined) return inputs.length > 0 ? { program: "", args: [], redirectedFrom: inputs } : undefined;
  return { program: program.split(/[\\/]/).pop() ?? program, args: words.slice(index + 1), redirectedFrom: inputs };
};

export const segmentsOf = (command: string): readonly Segment[] =>
  command.split(SEPARATORS).flatMap((part) => {
    const segment = segmentOf(part);
    return segment === undefined ? [] : [segment];
  });
