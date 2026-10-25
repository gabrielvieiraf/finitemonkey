import { isSensitivePath } from "./paths.js";
import type { Segment } from "./shell.js";

const READERS = new Set([
  "cat",
  "bat",
  "batcat",
  "less",
  "more",
  "head",
  "tail",
  "nl",
  "tac",
  "strings",
  "xxd",
  "hexdump",
  "od",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "awk",
  "gawk",
  "sed",
  "cut",
  "sort",
  "uniq",
  "jq",
  "yq",
  "base64",
  "type",
  "get-content",
  "gc",
  "select-string",
  "sls",
  "diff",
  "vim",
  "vi",
  "nano",
  "view",
  "dotenv",
]);

const SECRET_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|CREDENTIAL)/i;
const PERSON_ONLY = /\b(?:finitemonkey|fm)(?:\.mjs)?\s+secrets\s+(?:accept\b|incident\s+(?:rotated|close)\b)/;
const LISTS_ENV = new Set(["get-childitem", "gci", "dir", "ls"]);

export type BashFinding =
  | { readonly kind: "read"; readonly target: string }
  | { readonly kind: "env-dump"; readonly command: string }
  | { readonly kind: "person-only"; readonly command: string };

const onlyFlags = (args: readonly string[]): boolean => args.every((arg) => arg.startsWith("-"));

const readTarget = (segment: Segment): string | undefined => {
  const redirected = segment.redirectedFrom.find(isSensitivePath);
  if (redirected !== undefined) return redirected;
  const program = segment.program.toLowerCase();
  if (!READERS.has(program)) return undefined;
  if (program === "sed" && segment.args.some((arg) => arg.startsWith("-i"))) return undefined;
  return segment.args.find((arg) => !arg.startsWith("-") && isSensitivePath(arg));
};

const dumpsEnv = (segment: Segment): boolean => {
  const program = segment.program.toLowerCase();
  if (program === "env" || program === "printenv") {
    if (onlyFlags(segment.args)) return true;
    return program === "printenv" && segment.args.some((arg) => SECRET_NAME.test(arg));
  }
  if (program === "set" || program === "export" || program === "declare") {
    return segment.args.length === 0 || segment.args.every((arg) => arg === "-p" || arg === "-x");
  }
  return LISTS_ENV.has(program) && segment.args.some((arg) => /^env:/i.test(arg));
};

export const bashFindings = (command: string, segments: readonly Segment[]): readonly BashFinding[] => {
  const person = PERSON_ONLY.exec(command);
  if (person !== null) return [{ kind: "person-only", command: person[0] }];
  return segments.flatMap((segment): BashFinding[] => {
    const target = readTarget(segment);
    if (target !== undefined) return [{ kind: "read", target }];
    if (dumpsEnv(segment)) return [{ kind: "env-dump", command: [segment.program, ...segment.args].join(" ") }];
    return [];
  });
};

const GIT_GLOBALS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree"]);

export interface CommitIntent {
  readonly includeUnstaged: boolean;
}

export const commitIntent = (segments: readonly Segment[]): CommitIntent | undefined => {
  for (const segment of segments) {
    if (segment.program !== "git") continue;
    let index = 0;
    while (index < segment.args.length && (segment.args[index] ?? "").startsWith("-")) {
      index += GIT_GLOBALS_WITH_VALUE.has(segment.args[index] ?? "") ? 2 : 1;
    }
    if (segment.args[index] !== "commit") continue;
    const flags = segment.args.slice(index + 1);
    const all = flags.some((flag) => flag === "--all" || /^-[A-Za-z]*a[A-Za-z]*$/.test(flag));
    return { includeUnstaged: all };
  }
  return undefined;
};
