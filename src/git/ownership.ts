import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, optionalString, type Parsed, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { type DirtyEntry, parsePorcelainV2 } from "./facts.js";
import type { Repo } from "./repo.js";

export const OWNERSHIP_DIR = ".finitemonkey/git";

export type Hashes = Readonly<Record<string, string>>;

export interface Baseline {
  readonly owner: string;
  readonly at: string;
  readonly head: string | undefined;
  readonly files: Hashes;
}

export type ForeignReason = "before-session" | "not-session";

export interface ForeignFile {
  readonly path: string;
  readonly reason: ForeignReason;
}

export const ownerKey = (raw: string | undefined): string => {
  const cleaned = (raw ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return cleaned === "" ? "unknown" : cleaned;
};

const fileOf = (repo: Repo, kind: string, owner: string): AbsolutePath =>
  toAbsolutePath(join(repo.root, OWNERSHIP_DIR, kind, `${ownerKey(owner)}.json`));

export const readDirty = (runtime: Runtime, root: AbsolutePath): readonly DirtyEntry[] | undefined => {
  const status = runtime.git(["status", "--porcelain=v2", "-z", "--untracked-files=all"], root);
  return status.ok ? parsePorcelainV2(status.stdout) : undefined;
};

export const hashDirty = (runtime: Runtime, repo: Repo, entries: readonly DirtyEntry[]): Hashes => {
  const present = entries.filter((entry) => runtime.stat(toAbsolutePath(join(repo.root, entry.path)))?.kind === "file");
  const hashed =
    present.length === 0
      ? undefined
      : runtime.gitWith(["hash-object", "--stdin-paths"], repo.root, {
          input: `${present.map((entry) => entry.path).join("\n")}\n`,
        });
  const shas = hashed?.ok === true ? hashed.stdout.split("\n") : [];
  return Object.fromEntries(
    entries.map((entry) => {
      const index = present.indexOf(entry);
      return [entry.path, index < 0 ? "deleted" : (shas[index] ?? "unknown")] as const;
    }),
  );
};

const hashesOf = (value: unknown): Hashes =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

const readObject = (runtime: Runtime, path: AbsolutePath): Parsed<Readonly<Record<string, unknown>>> => {
  const text = runtime.readText(path);
  return text.ok ? parseJsonObject(text.value) : text;
};

export const readBaseline = (runtime: Runtime, repo: Repo, owner: string): Baseline | undefined => {
  const parsed = readObject(runtime, fileOf(repo, "baseline", owner));
  if (!parsed.ok) return undefined;
  return {
    owner,
    at: optionalString(parsed.value, "at") ?? "",
    head: optionalString(parsed.value, "head"),
    files: hashesOf(parsed.value["files"]),
  };
};

const readHashes = (runtime: Runtime, repo: Repo, owner: string): Hashes => {
  const parsed = readObject(runtime, fileOf(repo, "state", owner));
  return parsed.ok ? hashesOf(parsed.value["files"]) : {};
};

export const readEdits = (runtime: Runtime, repo: Repo, owner: string): ReadonlySet<string> => {
  const parsed = readObject(runtime, fileOf(repo, "edits", owner));
  const paths = parsed.ok ? parsed.value["paths"] : undefined;
  return new Set(Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : []);
};

const write = (runtime: Runtime, path: AbsolutePath, value: unknown): void => {
  runtime.writeText(path, `${JSON.stringify(value)}\n`);
};

export const recordBaseline = (runtime: Runtime, repo: Repo, owner: string): Baseline | undefined => {
  const existing = readBaseline(runtime, repo, owner);
  if (existing !== undefined) return existing;
  const entries = readDirty(runtime, repo.root);
  if (entries === undefined) return undefined;
  const head = runtime.git(["rev-parse", "--verify", "--quiet", "HEAD"], repo.root).stdout.trim();
  const baseline: Baseline = {
    owner,
    at: runtime.now(),
    head: head === "" ? undefined : head,
    files: hashDirty(runtime, repo, entries),
  };
  write(runtime, fileOf(repo, "baseline", owner), baseline);
  write(runtime, fileOf(repo, "state", owner), { files: baseline.files });
  return baseline;
};

export const recordEdits = (runtime: Runtime, repo: Repo, owner: string, paths: readonly string[]): void => {
  if (paths.length === 0) return;
  const known = readEdits(runtime, repo, owner);
  const merged = [...new Set([...known, ...paths])].sort();
  if (merged.length !== known.size) write(runtime, fileOf(repo, "edits", owner), { paths: merged });
};

export const recordShellChanges = (runtime: Runtime, repo: Repo, owner: string): void => {
  const entries = readDirty(runtime, repo.root);
  if (entries === undefined) return;
  const before = readHashes(runtime, repo, owner);
  const now = hashDirty(runtime, repo, entries);
  const changed = Object.entries(now)
    .filter(([path, hash]) => before[path] !== hash)
    .map(([path]) => path);
  recordEdits(runtime, repo, owner, changed);
  write(runtime, fileOf(repo, "state", owner), { files: now });
};

export const foreignFiles = (
  runtime: Runtime,
  repo: Repo,
  owner: string,
  targets: readonly string[],
): readonly ForeignFile[] => {
  const baseline = readBaseline(runtime, repo, owner);
  const edits = readEdits(runtime, repo, owner);
  return targets.flatMap((path): ForeignFile[] => {
    if (baseline !== undefined && Object.hasOwn(baseline.files, path)) return [{ path, reason: "before-session" }];
    return edits.has(path) ? [] : [{ path, reason: "not-session" }];
  });
};
