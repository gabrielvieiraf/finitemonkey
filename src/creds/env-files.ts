import type { AbsolutePath } from "../core/brand.js";
import { toAbsolutePath } from "../core/brand.js";
import { baseName, type CredsRuntime, readRepoFile, repoFiles } from "./files.js";

const ENV_FILE = /^\.env(?:\..+)?$/;
const TEMPLATE = /^\.env\.(?:example|sample|template|dist)$/;

export const isEnvFile = (file: string): boolean => ENV_FILE.test(baseName(file));
export const isEnvTemplate = (file: string): boolean => TEMPLATE.test(baseName(file));

export const environmentOf = (file: string): string => {
  const base = baseName(file);
  return base === ".env" ? "default" : base.slice(".env.".length);
};

export const namesIn = (text: string): readonly string[] =>
  [...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1] ?? "");

const dirsOf = (files: readonly string[]): readonly string[] => {
  const dirs = new Set<string>([""]);
  for (const file of files) {
    const parts = file.split("/").slice(0, -1);
    for (let depth = 1; depth <= Math.min(2, parts.length); depth += 1) dirs.add(parts.slice(0, depth).join("/"));
  }
  return [...dirs].sort();
};

export const envFiles = (runtime: CredsRuntime, root: AbsolutePath): readonly string[] => {
  const files = repoFiles(runtime, root);
  const found = new Set(files.filter(isEnvFile));
  for (const dir of dirsOf(files)) {
    const entries = runtime.listDir(dir === "" ? root : toAbsolutePath(dir, root));
    if (!entries.ok) continue;
    for (const name of entries.value) if (ENV_FILE.test(name)) found.add(dir === "" ? name : `${dir}/${name}`);
  }
  return [...found].sort();
};

export const envNames = (runtime: CredsRuntime, root: AbsolutePath, file: string): readonly string[] =>
  namesIn(readRepoFile(runtime, root, file) ?? "");
