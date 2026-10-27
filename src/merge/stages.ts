import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { generatorFor } from "../git/merge/generated.js";
import type { FileInputs, Stages } from "./resolve-file.js";
import { MARKER_SIZE } from "./segments.js";

interface StageIds {
  base?: string;
  ours?: string;
  theirs?: string;
}

const STAGE_NAMES = { "1": "base", "2": "ours", "3": "theirs" } as const;

export const conflictedStageIds = (runtime: Runtime, dir: AbsolutePath): ReadonlyMap<string, StageIds> => {
  const listed = runtime.gitWith(["ls-files", "-u", "-z"], dir, {});
  const byPath = new Map<string, StageIds>();
  for (const record of listed.stdout.split("\u0000")) {
    const match = /^\d+ ([0-9a-f]+) ([123])\t(.+)$/s.exec(record);
    const sha = match?.[1];
    const stage = match?.[2];
    const path = match?.[3];
    if (sha === undefined || path === undefined || (stage !== "1" && stage !== "2" && stage !== "3")) continue;
    byPath.set(path, { ...(byPath.get(path) ?? {}), [STAGE_NAMES[stage]]: sha });
  }
  return byPath;
};

const blob = (runtime: Runtime, dir: AbsolutePath, sha: string | undefined): string | undefined => {
  if (sha === undefined) return undefined;
  const result = runtime.gitWith(["cat-file", "blob", sha], dir, {});
  return result.ok ? result.stdout : undefined;
};

const diff3 = (runtime: Runtime, gitDir: AbsolutePath, stages: Stages): string | undefined => {
  if (stages.ours === undefined || stages.theirs === undefined) return undefined;
  const scratch = toAbsolutePath(join(gitDir, "finitemonkey-merge"));
  runtime.mkdir(scratch);
  const file = (name: string): AbsolutePath => toAbsolutePath(join(scratch, name));
  runtime.writeText(file("ours"), stages.ours);
  runtime.writeText(file("base"), stages.base ?? "");
  runtime.writeText(file("theirs"), stages.theirs);
  const merged = runtime.gitWith(
    [
      "merge-file",
      "-p",
      "--diff3",
      `--marker-size=${String(MARKER_SIZE)}`,
      "-L",
      "ours",
      "-L",
      "base",
      "-L",
      "theirs",
      "ours",
      "base",
      "theirs",
    ],
    scratch,
    {},
  );
  runtime.remove(scratch);
  return merged.found ? merged.stdout : undefined;
};

const linguistGenerated = (runtime: Runtime, dir: AbsolutePath, path: string): boolean =>
  /: linguist-generated: (set|true)$/m.test(
    runtime.gitWith(["check-attr", "linguist-generated", "--", path], dir, {}).stdout,
  );

export const fileInputs = (
  runtime: Runtime,
  dir: AbsolutePath,
  gitDir: AbsolutePath,
  path: string,
  ids: StageIds,
  generators: Readonly<Record<string, string>>,
): FileInputs => {
  const stages: Stages = {
    path,
    base: blob(runtime, dir, ids.base),
    ours: blob(runtime, dir, ids.ours),
    theirs: blob(runtime, dir, ids.theirs),
  };
  const current = runtime.readText(toAbsolutePath(join(dir, path)));
  return {
    stages,
    merged: diff3(runtime, gitDir, stages),
    worktreeText: current.ok ? current.value : undefined,
    linguistGenerated: linguistGenerated(runtime, dir, path),
    generator: generatorFor(path, generators),
  };
};
