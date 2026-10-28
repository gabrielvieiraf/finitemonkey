import { isAbsolute, join, resolve } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const text = (runtime: Runtime, path: string): string | undefined => {
  const read = runtime.readText(toAbsolutePath(path));
  return read.ok ? read.value.trim() : undefined;
};

const gitDirOf = (runtime: Runtime, root: AbsolutePath): string | undefined => {
  const dotGit = join(root, ".git");
  const kind = runtime.stat(toAbsolutePath(dotGit))?.kind;
  if (kind === "dir") return dotGit;
  if (kind !== "file") return undefined;
  const pointer = /^gitdir:\s*(.+)$/m.exec(text(runtime, dotGit) ?? "")?.[1]?.trim();
  if (pointer === undefined) return undefined;
  return isAbsolute(pointer) ? pointer : resolve(root, pointer);
};

const packedRef = (runtime: Runtime, dir: string, ref: string): string | undefined =>
  (text(runtime, join(dir, "packed-refs")) ?? "")
    .split("\n")
    .map((line) => line.trim().split(" "))
    .find((parts) => parts[1] === ref)?.[0];

const refSha = (runtime: Runtime, dirs: readonly string[], ref: string): string | undefined => {
  for (const dir of dirs) {
    const loose = text(runtime, join(dir, ...ref.split("/")));
    if (loose !== undefined && SHA.test(loose)) return loose;
    const packed = packedRef(runtime, dir, ref);
    if (packed !== undefined && SHA.test(packed)) return packed;
  }
  return undefined;
};

export const headShaFromFiles = (runtime: Runtime, root: AbsolutePath): string | undefined => {
  const gitDir = gitDirOf(runtime, root);
  if (gitDir === undefined) return undefined;
  const head = text(runtime, join(gitDir, "HEAD"));
  if (head === undefined) return undefined;
  if (SHA.test(head)) return head;
  const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
  if (ref === undefined) return undefined;
  const common = text(runtime, join(gitDir, "commondir"));
  const dirs = common === undefined ? [gitDir] : [gitDir, isAbsolute(common) ? common : resolve(gitDir, common)];
  return refSha(runtime, dirs, ref);
};
