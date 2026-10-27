import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import { toPosixPath, withoutCarriageReturn } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { AST_FILES, CODE_FILES, type Definition, extensionOf, GREP_PATTERN, isCode, nameIn } from "./defs.js";

export const AST_GREP = "ast-grep";
const TIMEOUT_MS = 30_000;
const PROBE_MS = 3_000;

const SCRIPT_RULES: readonly string[] = [
  "export function $N($$$) { $$$ }",
  "export async function $N($$$) { $$$ }",
  "export const $N = $V",
  "export class $N { $$$ }",
];

const TYPED_RULES: readonly string[] = ["export interface $N { $$$ }", "export type $N = $V"];

const AST_RULES: readonly (readonly [string, string])[] = [
  ...[...SCRIPT_RULES, ...TYPED_RULES].map((rule) => ["ts", rule] as const),
  ...[...SCRIPT_RULES, ...TYPED_RULES].map((rule) => ["tsx", rule] as const),
  ...SCRIPT_RULES.map((rule) => ["js", rule] as const),
  ["py", "def $N($$$): $$$"],
  ["py", "class $N: $$$"],
  ["py", "class $N($$$): $$$"],
];

const topLevelMatch = (line: string): Definition | undefined => {
  const parsed = parseJson(line);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const { file, range, metaVariables } = parsed.value;
  const start = isRecord(range) ? range["start"] : undefined;
  const single = isRecord(metaVariables) ? metaVariables["single"] : undefined;
  const variable = isRecord(single) ? single["N"] : undefined;
  const name = isRecord(variable) ? variable["text"] : undefined;
  if (typeof file !== "string" || typeof name !== "string") return undefined;
  return isRecord(start) && start["column"] === 0 ? { file: toPosixPath(file), name } : undefined;
};

export const astGrepFound = (runtime: Pick<Runtime, "probe">): boolean =>
  runtime.probe(AST_GREP, ["--version"], PROBE_MS).found;

export const astGrepDefinitions = (runtime: Pick<Runtime, "exec">, root: AbsolutePath): readonly Definition[] =>
  AST_RULES.flatMap(([lang, pattern]) => {
    const result = runtime.exec({
      command: AST_GREP,
      args: ["run", "--pattern", pattern, "--lang", lang, "--json=stream", "."],
      cwd: root,
      timeoutMs: TIMEOUT_MS,
    });
    if (!result.found) return [];
    return result.stdout
      .split("\n")
      .map(withoutCarriageReturn)
      .filter((line) => line !== "")
      .flatMap((line) => topLevelMatch(line) ?? [])
      .filter((item) => isCode(item.file));
  });

const GREP_LINE = /^(.+?):\d+:(.*)$/;

export const grepDefinitions = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
  skipAstFiles: boolean,
): readonly Definition[] => {
  const extensions = CODE_FILES.filter((ext) => !(skipAstFiles && AST_FILES.has(ext)));
  const spec = extensions.map((ext) => `:(glob)**/*.${ext}`);
  const out =
    gitAt(runtime, root).out(["grep", "--untracked", "-n", "-I", "-E", "-e", GREP_PATTERN, "--", ...spec]) ?? "";
  return out
    .split("\n")
    .map(withoutCarriageReturn)
    .flatMap((line) => {
      const match = GREP_LINE.exec(line);
      const file = match?.[1];
      const name = nameIn(match?.[2] ?? "");
      return file === undefined || name === undefined || !isCode(file) ? [] : [{ file, name }];
    })
    .filter((item) => !(skipAstFiles && AST_FILES.has(extensionOf(item.file))));
};
