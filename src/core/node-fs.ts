import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import type { AbsolutePath } from "./brand.js";
import { accept, type Parsed, reject } from "./parsed.js";

const SKIPPED_DIRS = new Set([".git", "node_modules"]);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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

export const nodeListDir = (path: AbsolutePath): Parsed<readonly string[]> => {
  try {
    return accept(readdirSync(path).sort());
  } catch (error) {
    return reject(messageOf(error));
  }
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
