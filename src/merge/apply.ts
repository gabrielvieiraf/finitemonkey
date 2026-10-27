import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { MergeStop } from "./report.js";
import type { FileResolution } from "./resolve-file.js";

const GENERATOR_TIMEOUT_MS = 300_000;

const git = (runtime: Runtime, dir: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.gitWith(args, dir, {});
  return result.ok ? undefined : `git ${args.join(" ")}: ${result.stderr.trim()}`;
};

const applyOne = (runtime: Runtime, dir: AbsolutePath, file: FileResolution): string | undefined => {
  const { action, path } = file;
  switch (action.kind) {
    case "write": {
      const written = runtime.writeText(toAbsolutePath(join(dir, path)), action.text);
      return written.ok ? git(runtime, dir, ["add", "--", path]) : written.error;
    }
    case "delete":
      return git(runtime, dir, ["rm", "-q", "--", path]);
    case "take-ours-and-generate":
      return git(runtime, dir, ["checkout", "--ours", "--", path]) ?? git(runtime, dir, ["add", "--", path]);
    case "none":
      return undefined;
  }
};

export const applyResolutions = (
  runtime: Runtime,
  dir: AbsolutePath,
  files: readonly FileResolution[],
): readonly MergeStop[] =>
  files.flatMap((file) => {
    const failed = file.stop === undefined ? applyOne(runtime, dir, file) : undefined;
    return failed === undefined ? [] : [{ reason: `apply-failed: ${failed}`, path: file.path }];
  });

const runGenerator = (runtime: Runtime, dir: AbsolutePath, command: string): boolean =>
  runtime.exec({ command, args: [], cwd: dir, timeoutMs: GENERATOR_TIMEOUT_MS, shell: true }).exitCode === 0;

const read = (runtime: Runtime, dir: AbsolutePath, path: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(join(dir, path)));
  return text.ok ? text.value : undefined;
};

export const regenerate = (
  runtime: Runtime,
  dir: AbsolutePath,
  files: readonly FileResolution[],
): readonly MergeStop[] =>
  files.flatMap((file) => {
    if (file.stop !== undefined || file.action.kind !== "take-ours-and-generate") return [];
    const { command } = file.action;
    if (!runGenerator(runtime, dir, command)) return [{ reason: `C4:generator-failed: ${command}`, path: file.path }];
    const first = read(runtime, dir, file.path);
    if (!runGenerator(runtime, dir, command)) return [{ reason: `C4:generator-failed: ${command}`, path: file.path }];
    if (read(runtime, dir, file.path) !== first) return [{ reason: "C4:generator-not-stable", path: file.path }];
    const added = git(runtime, dir, ["add", "--", file.path]);
    return added === undefined ? [] : [{ reason: `apply-failed: ${added}`, path: file.path }];
  });
