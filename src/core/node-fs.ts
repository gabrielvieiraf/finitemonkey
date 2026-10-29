import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import type { AbsolutePath } from "./brand.js";
import { accept, type Parsed, reject } from "./parsed.js";
import type { FileStat, LockOptions, ReleaseLock } from "./runtime.js";

const NEW_FILE_MODE = 0o644;

const SKIPPED_DIRS = new Set([".git", "node_modules"]);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const errnoOf = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;

const attempt = (work: () => void): Parsed<undefined> => {
  try {
    work();
    return accept(undefined);
  } catch (error) {
    return reject(messageOf(error));
  }
};

export const nodeWriteText = (path: AbsolutePath, text: string): Parsed<true> => {
  const temp = `${path}.${String(process.pid)}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    return accept(true);
  } catch (error) {
    rmSync(temp, { force: true });
    return reject(messageOf(error));
  }
};

export const nodeStat = (path: AbsolutePath): FileStat | undefined => {
  try {
    const stats = statSync(path);
    return { kind: stats.isDirectory() ? "dir" : "file", mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return undefined;
  }
};

export const nodeListDir = (path: AbsolutePath): Parsed<readonly string[]> => {
  try {
    return accept(readdirSync(path).sort());
  } catch (error) {
    return reject(messageOf(error));
  }
};

const modeOf = (path: string): number => {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return NEW_FILE_MODE;
  }
};

const writeAndSync = (file: string, content: string, mode: number): void => {
  const fd = openSync(file, "wx", mode);
  try {
    writeSync(fd, content, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

export const nodeWriteAtomic = (path: AbsolutePath, content: string): Parsed<undefined> => {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  return attempt(() => {
    try {
      writeAndSync(temp, content, modeOf(path));
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  });
};

export const nodeRename = (from: AbsolutePath, to: AbsolutePath): Parsed<undefined> =>
  attempt(() => {
    renameSync(from, to);
  });

export const nodeMkdir = (path: AbsolutePath): Parsed<undefined> =>
  attempt(() => {
    mkdirSync(path, { recursive: true });
  });

export const nodeRemove = (path: AbsolutePath): Parsed<undefined> =>
  attempt(() => {
    rmSync(path, { recursive: true, force: true });
  });

const createLock = (path: AbsolutePath, owner: string, now: number): void => {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeSync(fd, `${JSON.stringify({ owner, pid: process.pid, at: now })}\n`, null, "utf8");
  } finally {
    closeSync(fd);
  }
};

const release =
  (path: AbsolutePath): ReleaseLock =>
  () => {
    try {
      unlinkSync(path);
    } catch {
      return;
    }
  };

const isStale = (path: AbsolutePath, staleMs: number, now: number): boolean => {
  const stat = nodeStat(path);
  return stat !== undefined && now - stat.mtimeMs > staleMs;
};

export const nodeLock = (path: AbsolutePath, options: LockOptions): Parsed<ReleaseLock> => {
  for (let round = 0; round < 2; round += 1) {
    const now = Date.now();
    try {
      createLock(path, options.owner, now);
      return accept(release(path));
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") return reject(messageOf(error));
      if (!isStale(path, options.staleMs, now)) return reject(`locked: ${path}`);
      rmSync(path, { force: true });
    }
  }
  return reject(`locked: ${path}`);
};

const walkInto = (root: string, dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walkInto(root, full, out);
    } else if (entry.isFile()) {
      out.push(relative(root, full).split("\\").join("/"));
    }
  }
};

export const nodeWalkFiles = (root: AbsolutePath): Parsed<readonly string[]> => {
  try {
    const out: string[] = [];
    walkInto(root, root, out);
    return accept(out.sort());
  } catch (error) {
    return reject(messageOf(error));
  }
};
