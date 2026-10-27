import type { AbsolutePath } from "../core/brand.js";
import { withoutCarriageReturn } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { CODE_FILES, GREP_PATTERN, isCode, nameIn } from "../map/defs.js";
import { normalizeName } from "./names.js";

export interface IndexedDefinition {
  readonly file: string;
  readonly line: number;
  readonly name: string;
}

const GREP_LINE = /^(.+?):(\d+):(.*)$/;

export type IndexResult =
  | { readonly kind: "ok"; readonly definitions: readonly IndexedDefinition[] }
  | { readonly kind: "failed"; readonly detail: string };

export const projectDefinitions = (runtime: Pick<Runtime, "exec">, root: AbsolutePath): IndexResult => {
  const spec = CODE_FILES.map((ext) => `:(glob)**/*.${ext}`);
  const result = gitAt(runtime, root).run(["grep", "--untracked", "-n", "-I", "-E", "-e", GREP_PATTERN, "--", ...spec]);
  if (!result.found) return { kind: "failed", detail: "git not found" };
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return { kind: "failed", detail: `git grep exited ${String(result.exitCode)}: ${result.stderr.slice(0, 200)}` };
  }
  const definitions = result.stdout
    .split("\n")
    .map(withoutCarriageReturn)
    .flatMap((line) => {
      const match = GREP_LINE.exec(line);
      const file = match?.[1];
      const name = nameIn(match?.[3] ?? "");
      return file === undefined || name === undefined || !isCode(file)
        ? []
        : [{ file, line: Number(match?.[2] ?? "0"), name }];
    });
  return { kind: "ok", definitions };
};

export const elsewhere = (
  definitions: readonly IndexedDefinition[],
  name: string,
  file: string,
): IndexedDefinition | undefined => {
  const wanted = normalizeName(name);
  return definitions.find((item) => item.file !== file && normalizeName(item.name) === wanted);
};
