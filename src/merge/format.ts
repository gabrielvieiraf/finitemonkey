import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, type ConfigTree } from "../git/project-config.js";
import type { MergeCheck, MergeStop } from "./report.js";
import type { FileResolution } from "./resolve-file.js";

const FORMAT_TIMEOUT_MS = 120_000;

export interface Formatted {
  readonly check: MergeCheck | undefined;
  readonly stops: readonly MergeStop[];
}

export const mergeFormatter = (config: ConfigTree): string | undefined => {
  const node = configAt(config, "merge", "formatter");
  return typeof node === "string" && node.trim() !== "" ? node.trim() : undefined;
};

const quoted = (path: string): string => `"${path.replace(/(["\\$`])/g, "\\$1")}"`;

export const formattedPaths = (files: readonly FileResolution[]): readonly string[] =>
  files
    .filter(
      (file) =>
        file.stop === undefined &&
        file.action.kind === "write" &&
        (file.cls === "C3" || file.hunks.some((hunk) => hunk.verdict.cls === "C3")),
    )
    .map((file) => file.path);

export const formatC3 = (
  runtime: Runtime,
  dir: AbsolutePath,
  files: readonly FileResolution[],
  formatter: string | undefined,
): Formatted => {
  const paths = formattedPaths(files);
  if (formatter === undefined || paths.length === 0) return { check: undefined, stops: [] };
  const command = `${formatter} ${paths.map(quoted).join(" ")}`;
  const result = runtime.exec({ command, args: [], cwd: dir, timeoutMs: FORMAT_TIMEOUT_MS, shell: true });
  const added = result.exitCode === 0 && runtime.gitWith(["add", "--", ...paths], dir, {}).ok;
  const detail = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-3).join(" | ");
  const check: MergeCheck = { name: "format", command, ok: added, detail };
  return { check, stops: added ? [] : [{ reason: `C3:formatter-failed: ${formatter}`, path: null }] };
};
