import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type Parsed, parseJsonObject, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { isSensitivePath } from "../secrets/guards/paths.js";
import { configAt, loadProjectConfig } from "./project-config.js";
import type { Repo } from "./repo.js";

export const FILES_SCHEMA = "finitemonkey/snapshot-files@1";
export const DEFAULT_CAP_MB = 50;
export const CONFLICT_SUFFIX = ".finitemonkey-restored";
export const MB = 1024 * 1024;

export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "vendor",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".gradle",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  ".finitemonkey",
  ".git",
]);

export interface StoredFile {
  readonly path: string;
  readonly size: number;
}

export interface SkippedFile {
  readonly path: string;
  readonly reason: "cap" | "dependency";
  readonly size?: number;
}

export interface FileManifest {
  readonly schema: typeof FILES_SCHEMA;
  readonly at: string;
  readonly files: readonly StoredFile[];
  readonly skipped: readonly SkippedFile[];
}

export interface RestoreOutcome {
  readonly restored: readonly string[];
  readonly conflicts: readonly string[];
}

type StoreRuntime = Pick<Runtime, "git" | "stat" | "copyFile" | "readText" | "writeText" | "mkdir">;

export const storeDir = (repo: Repo, name: string): AbsolutePath =>
  toAbsolutePath(join(repo.gitDir, "finitemonkey", "snapshots", name));

export const capBytes = (runtime: Runtime, repo: Repo): number => {
  const raw = configAt(loadProjectConfig(runtime, repo.root), "snapshot", "max_mb");
  const value = typeof raw === "string" ? Number(raw) : Number.NaN;
  return (Number.isFinite(value) && value > 0 ? value : DEFAULT_CAP_MB) * MB;
};

const listed = (runtime: StoreRuntime, repo: Repo, args: readonly string[]): readonly string[] => {
  const result = runtime.git(["ls-files", "-z", ...args], repo.root);
  return result.ok ? result.stdout.split("\u0000").filter((path) => path !== "") : [];
};

const heavy = (path: string): boolean => path.split("/").some((part) => SKIPPED_DIRS.has(part));

const candidates = (runtime: StoreRuntime, repo: Repo): { files: string[]; skipped: SkippedFile[] } => {
  const files: string[] = [];
  const skipped: SkippedFile[] = [];
  for (const entry of listed(runtime, repo, ["--others", "--ignored", "--exclude-standard", "--directory"])) {
    if (heavy(entry)) skipped.push({ path: entry, reason: "dependency" });
    else if (entry.endsWith("/")) {
      const inside = listed(runtime, repo, ["--others", "--ignored", "--exclude-standard", "--", entry]);
      for (const path of inside) {
        if (heavy(path)) skipped.push({ path, reason: "dependency" });
        else files.push(path);
      }
    } else files.push(entry);
  }
  const sensitive = listed(runtime, repo, ["--cached", "--others", "--exclude-standard"]).filter(isSensitivePath);
  return { files: [...new Set([...files, ...sensitive])].sort(), skipped };
};

export const saveFiles = (
  runtime: StoreRuntime,
  repo: Repo,
  name: string,
  at: string,
  cap: number,
): Parsed<FileManifest> => {
  const dir = storeDir(repo, name);
  const found = candidates(runtime, repo);
  const files: StoredFile[] = [];
  const skipped = [...found.skipped];
  let total = 0;
  for (const path of found.files) {
    const from = toAbsolutePath(join(repo.root, path));
    const stat = runtime.stat(from);
    if (stat?.kind !== "file") continue;
    const size = stat.size ?? 0;
    if (total + size > cap) {
      skipped.push({ path, reason: "cap", size });
      continue;
    }
    const copied = runtime.copyFile(from, toAbsolutePath(join(dir, "files", path)));
    if (!copied.ok) return reject(`copy ${path}: ${copied.error}`);
    total += size;
    files.push({ path, size });
  }
  const manifest: FileManifest = { schema: FILES_SCHEMA, at, files, skipped };
  runtime.mkdir(dir);
  const written = runtime.writeText(toAbsolutePath(join(dir, "manifest.json")), `${JSON.stringify(manifest)}\n`);
  return written.ok ? accept(manifest) : reject(`manifest: ${written.error}`);
};

const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export const readManifest = (runtime: StoreRuntime, repo: Repo, name: string): FileManifest | undefined => {
  const text = runtime.readText(toAbsolutePath(join(storeDir(repo, name), "manifest.json")));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return undefined;
  const items = (key: string): readonly Record<string, unknown>[] => {
    const value = parsed.value[key];
    return Array.isArray(value) ? value.filter(isRecord) : [];
  };
  return {
    schema: FILES_SCHEMA,
    at: stringOf(parsed.value["at"]) ?? "",
    files: items("files").flatMap((item) => {
      const path = stringOf(item["path"]);
      const size = item["size"];
      return path === undefined ? [] : [{ path, size: typeof size === "number" ? size : 0 }];
    }),
    skipped: items("skipped").flatMap((item) => {
      const path = stringOf(item["path"]);
      return path === undefined ? [] : [{ path, reason: item["reason"] === "cap" ? "cap" : "dependency" }];
    }),
  };
};

export const restoreFiles = (
  runtime: StoreRuntime,
  repo: Repo,
  name: string,
  target: AbsolutePath,
): Parsed<RestoreOutcome> => {
  const manifest = readManifest(runtime, repo, name);
  if (manifest === undefined) return accept({ restored: [], conflicts: [] });
  const restored: string[] = [];
  const conflicts: string[] = [];
  for (const file of manifest.files) {
    const from = toAbsolutePath(join(storeDir(repo, name), "files", file.path));
    const to = toAbsolutePath(join(target, file.path));
    const current = runtime.readText(to);
    if (current.ok) {
      const saved = runtime.readText(from);
      if (saved.ok && saved.value === current.value) continue;
      const copied = runtime.copyFile(from, toAbsolutePath(`${to}${CONFLICT_SUFFIX}`));
      if (!copied.ok) return reject(`restore ${file.path}: ${copied.error}`);
      conflicts.push(file.path);
      continue;
    }
    const copied = runtime.copyFile(from, to);
    if (!copied.ok) return reject(`restore ${file.path}: ${copied.error}`);
    restored.push(file.path);
  }
  return accept({ restored, conflicts });
};
