import { heredocIn, type ShellSegment, shellWords } from "./shell-words.js";

export const PROSE_TARGETS = ["commit", "pr", "issue"] as const;

export type ProseTarget = (typeof PROSE_TARGETS)[number];

export type TextSource =
  { readonly kind: "inline"; readonly text: string } | { readonly kind: "file"; readonly path: string };

export interface CommandProse {
  readonly target: ProseTarget;
  readonly title: TextSource | undefined;
  readonly bodies: readonly TextSource[];
}

interface FlagSpec {
  readonly title: readonly string[];
  readonly body: readonly string[];
  readonly file: readonly string[];
}

const GIT_FLAGS: FlagSpec = { title: [], body: ["-m", "--message"], file: ["-F", "--file"] };
const GH_FLAGS: FlagSpec = { title: ["-t", "--title"], body: ["-b", "--body"], file: ["-F", "--body-file"] };
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const CLUSTER_WITH_MESSAGE = /^-[a-zA-Z]*m$/;
const FM_PROGRAMS: ReadonlySet<string> = new Set(["finitemonkey", "fm"]);

interface FlagValue {
  readonly flag: string;
  readonly value: string;
}

const flagValues = (args: readonly string[], spec: FlagSpec): readonly FlagValue[] => {
  const known = [...spec.title, ...spec.body, ...spec.file];
  const out: FlagValue[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const equals = arg.indexOf("=");
    const name = arg.startsWith("--") && equals > 0 ? arg.slice(0, equals) : arg;
    if (name !== arg && known.includes(name)) {
      out.push({ flag: name, value: arg.slice(equals + 1) });
    } else if (known.includes(arg) || (spec === GIT_FLAGS && CLUSTER_WITH_MESSAGE.test(arg))) {
      out.push({ flag: known.includes(arg) ? arg : "-m", value: args[index + 1] ?? "" });
      index += 1;
    }
  }
  return out;
};

const sourceOf = (value: string, isFile: boolean, segment: ShellSegment, heredocs: readonly string[]): TextSource => {
  const inline = heredocIn(value, heredocs);
  if (inline !== undefined) return { kind: "inline", text: inline };
  if (!isFile) return { kind: "inline", text: value };
  if (value !== "-") return { kind: "file", path: value };
  const piped = segment.args.map((arg) => heredocIn(arg, heredocs)).find((text) => text !== undefined);
  return { kind: "inline", text: piped ?? "" };
};

const collect = (
  target: ProseTarget,
  segment: ShellSegment,
  args: readonly string[],
  spec: FlagSpec,
  heredocs: readonly string[],
): CommandProse | undefined => {
  const values = flagValues(args, spec);
  if (values.length === 0) return undefined;
  const title = values.find((item) => spec.title.includes(item.flag));
  const bodies = values
    .filter((item) => !spec.title.includes(item.flag))
    .map((item) => sourceOf(item.value, spec.file.includes(item.flag), segment, heredocs));
  return { target, title: title === undefined ? undefined : sourceOf(title.value, false, segment, heredocs), bodies };
};

const gitSubcommand = (args: readonly string[]): number => {
  let index = 0;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    index += GIT_GLOBAL_WITH_VALUE.has(args[index] ?? "") ? 2 : 1;
  }
  return index;
};

const fromSegment = (segment: ShellSegment, heredocs: readonly string[]): CommandProse | undefined => {
  if (segment.program === "git") {
    const at = gitSubcommand(segment.args);
    if (segment.args[at] !== "commit") return undefined;
    return collect("commit", segment, segment.args.slice(at + 1), GIT_FLAGS, heredocs);
  }
  if (FM_PROGRAMS.has(segment.program) && segment.args[0] === "pr" && segment.args[1] === "open") {
    return collect("pr", segment, segment.args.slice(2), GH_FLAGS, heredocs);
  }
  if (segment.program !== "gh") return undefined;
  const [noun, verb] = segment.args;
  const isPr = noun === "pr" && (verb === "create" || verb === "edit");
  const isIssue = noun === "issue" && (verb === "create" || verb === "edit");
  if (!isPr && !isIssue) return undefined;
  return collect(isPr ? "pr" : "issue", segment, segment.args.slice(2), GH_FLAGS, heredocs);
};

export const proseInCommand = (command: string): readonly CommandProse[] => {
  const { segments, heredocs } = shellWords(command);
  return segments.flatMap((segment) => {
    const found = fromSegment(segment, heredocs);
    return found === undefined ? [] : [found];
  });
};
