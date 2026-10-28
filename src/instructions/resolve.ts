import { dirname, isAbsolute, join, relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { globToRegExp } from "../core/glob.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { frontmatterGlobs, importsOf } from "./parse.js";
import {
  type InstructionFile,
  type Inventory,
  type Layer,
  lineCount,
  type LoadReason,
  type ShadowedFile,
  tokenEstimate,
} from "./types.js";

export type ResolveRuntime = Pick<Runtime, "readText" | "listDir" | "stat">;

export interface ResolveInput {
  readonly runtime: ResolveRuntime;
  readonly root: AbsolutePath;
  readonly cwd: AbsolutePath;
  readonly home: string;
  readonly platform: NodeJS.Platform;
}

export const MAX_IMPORT_HOPS = 4;
const MAX_WALK_DEPTH = 8;
const MAX_WALK_DIRS = 3000;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "vendor", "target", "coverage", "out"]);
const PRIMARY = ["CLAUDE.md", ".claude/CLAUDE.md"] as const;
const LOCAL = "CLAUDE.local.md";
const AGENTS = "AGENTS.md";

export const MANAGED_FILES: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  linux: "/etc/claude-code/CLAUDE.md",
  darwin: "/Library/Application Support/ClaudeCode/CLAUDE.md",
  win32: "C:\\Program Files\\ClaudeCode\\CLAUDE.md",
};

interface Settings {
  readonly instructionFiles: readonly string[];
  readonly excludes: readonly string[];
}

interface Candidate {
  readonly path: AbsolutePath;
  readonly layer: Layer;
  readonly reason: LoadReason;
  readonly survives: boolean;
  readonly globs: readonly string[];
  readonly parent: string | undefined;
}

const read = (runtime: ResolveRuntime, path: AbsolutePath): string | undefined => {
  const text = runtime.readText(path);
  return text.ok ? text.value : undefined;
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];

const settingsOf = (input: ResolveInput): Settings => {
  const files = [
    join(input.home, ".claude", "settings.json"),
    join(input.root, ".claude", "settings.json"),
    join(input.root, ".claude", "settings.local.json"),
  ];
  const parsed = files.flatMap((file) => {
    const text = read(input.runtime, toAbsolutePath(file));
    const json = text === undefined ? undefined : parseJsonObject(text);
    return json?.ok === true && isRecord(json.value) ? [json.value] : [];
  });
  return {
    instructionFiles: [...new Set(parsed.flatMap((item) => strings(item["instructionFiles"])))],
    excludes: [...new Set(parsed.flatMap((item) => strings(item["claudeMdExcludes"])))],
  };
};

const ancestorsOf = (cwd: AbsolutePath): readonly AbsolutePath[] => {
  const chain: AbsolutePath[] = [];
  let current = cwd;
  for (;;) {
    const parent = toAbsolutePath(dirname(current));
    if (parent === current) break;
    chain.push(current);
    current = parent;
  }
  return chain.reverse();
};

const isFile = (runtime: ResolveRuntime, path: AbsolutePath): boolean => runtime.stat(path)?.kind === "file";

const markdownBelow = (runtime: ResolveRuntime, dir: AbsolutePath, depth = 0): readonly AbsolutePath[] => {
  const listed = runtime.listDir(dir);
  if (!listed.ok || depth > MAX_WALK_DEPTH) return [];
  return [...listed.value].sort().flatMap((name) => {
    const path = toAbsolutePath(join(dir, name));
    const kind = runtime.stat(path)?.kind;
    if (kind === "dir") return markdownBelow(runtime, path, depth + 1);
    return kind === "file" && name.endsWith(".md") ? [path] : [];
  });
};

const nestedDirs = (runtime: ResolveRuntime, start: AbsolutePath): readonly AbsolutePath[] => {
  const found: AbsolutePath[] = [];
  const queue: { readonly dir: AbsolutePath; readonly depth: number }[] = [{ dir: start, depth: 0 }];
  let seen = 0;
  while (queue.length > 0 && seen < MAX_WALK_DIRS) {
    const next = queue.shift();
    if (next === undefined) break;
    seen += 1;
    const listed = runtime.listDir(next.dir);
    if (!listed.ok || next.depth >= MAX_WALK_DEPTH) continue;
    for (const name of [...listed.value].sort()) {
      if (name.startsWith(".") || SKIPPED_DIRS.has(name)) continue;
      const path = toAbsolutePath(join(next.dir, name));
      if (runtime.stat(path)?.kind !== "dir") continue;
      found.push(path);
      queue.push({ dir: path, depth: next.depth + 1 });
    }
  }
  return found;
};

const candidate = (
  path: AbsolutePath,
  layer: Layer,
  reason: LoadReason,
  extra: Partial<Pick<Candidate, "globs" | "parent">> = {},
): Candidate => ({
  path,
  layer,
  reason,
  survives: reason === "session_start",
  globs: extra.globs ?? [],
  parent: extra.parent,
});

const rulesIn = (runtime: ResolveRuntime, dir: AbsolutePath, layer: Layer): readonly Candidate[] =>
  markdownBelow(runtime, dir).map((path) => {
    const globs = frontmatterGlobs(read(runtime, path) ?? "");
    return candidate(path, layer, globs.length === 0 ? "session_start" : "path_glob_match", { globs });
  });

const primaryNames = (settings: Settings): readonly string[] => [
  ...PRIMARY,
  ...settings.instructionFiles.filter((name) => name !== LOCAL),
];

const ancestorFiles = (input: ResolveInput, settings: Settings, dirs: readonly AbsolutePath[]) => {
  const names = primaryNames(settings);
  const at = (dir: AbsolutePath, name: string): AbsolutePath => toAbsolutePath(join(dir, ...name.split("/")));
  const hasClaude = dirs.some((dir) => PRIMARY.some((name) => isFile(input.runtime, at(dir, name))));
  const agentsListed = names.includes(AGENTS);
  const loaded: Candidate[] = [];
  const shadowed: AbsolutePath[] = [];
  for (const dir of dirs) {
    for (const name of names)
      if (isFile(input.runtime, at(dir, name))) loaded.push(candidate(at(dir, name), "project", "session_start"));
    if (isFile(input.runtime, at(dir, LOCAL))) loaded.push(candidate(at(dir, LOCAL), "local", "session_start"));
    const agents = at(dir, AGENTS);
    if (agentsListed || !isFile(input.runtime, agents)) continue;
    if (hasClaude) shadowed.push(agents);
    else loaded.push(candidate(agents, "agents", "session_start"));
  }
  return { loaded, shadowed };
};

const nestedFiles = (input: ResolveInput, settings: Settings): readonly Candidate[] =>
  nestedDirs(input.runtime, input.cwd).flatMap((dir) =>
    [...primaryNames(settings), LOCAL].flatMap((name) => {
      const path = toAbsolutePath(join(dir, ...name.split("/")));
      return isFile(input.runtime, path) ? [candidate(path, "nested", "nested_traversal")] : [];
    }),
  );

const baseCandidates = (input: ResolveInput, settings: Settings) => {
  const managed = MANAGED_FILES[input.platform];
  const managedPath = managed === undefined ? undefined : toAbsolutePath(managed);
  const userFile = toAbsolutePath(join(input.home, ".claude", "CLAUDE.md"));
  const ancestors = ancestorFiles(input, settings, ancestorsOf(input.cwd));
  const listed: readonly Candidate[] = [
    ...(managedPath !== undefined && isFile(input.runtime, managedPath)
      ? [candidate(managedPath, "managed", "session_start")]
      : []),
    ...(isFile(input.runtime, userFile) ? [candidate(userFile, "user", "session_start")] : []),
    ...rulesIn(input.runtime, toAbsolutePath(join(input.home, ".claude", "rules")), "user"),
    ...ancestors.loaded,
    ...rulesIn(input.runtime, toAbsolutePath(join(input.root, ".claude", "rules")), "rules"),
    ...nestedFiles(input, settings),
  ];
  return { listed, shadowed: ancestors.shadowed };
};

const resolveImport = (input: ResolveInput, from: AbsolutePath, target: string): AbsolutePath => {
  if (target.startsWith("~/")) return toAbsolutePath(join(input.home, ...target.slice(2).split("/")));
  if (isAbsolute(target)) return toAbsolutePath(target);
  return toAbsolutePath(join(dirname(from), ...target.split("/")));
};

const excluded = (settings: Settings, item: Candidate): boolean =>
  item.layer !== "managed" && settings.excludes.some((glob) => globToRegExp(glob).test(toPosixPath(item.path)));

export const displayPath = (input: Pick<ResolveInput, "root" | "home">, path: string): string => {
  const inside = (base: string): string | undefined => {
    const rel = relative(base, path);
    return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? undefined : toPosixPath(rel);
  };
  const project = inside(input.root);
  if (project !== undefined) return project;
  const home = inside(input.home);
  return home === undefined ? toPosixPath(path) : `~/${home}`;
};

const withImports = (input: ResolveInput, settings: Settings, listed: readonly Candidate[]): readonly Candidate[] => {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const visit = (item: Candidate, hops: number): void => {
    const key = toPosixPath(item.path);
    if (seen.has(key) || excluded(settings, item)) return;
    seen.add(key);
    out.push(item);
    if (hops >= MAX_IMPORT_HOPS) return;
    for (const target of importsOf(read(input.runtime, item.path) ?? "")) {
      const path = resolveImport(input, item.path, target);
      if (!isFile(input.runtime, path)) continue;
      visit({ ...item, path, layer: "import", reason: "include", globs: [], parent: key }, hops + 1);
    }
  };
  for (const item of listed) visit(item, 0);
  return out;
};

const toFile = (input: ResolveInput, item: Candidate): InstructionFile => {
  const text = read(input.runtime, item.path) ?? "";
  return {
    path: toPosixPath(item.path),
    display: displayPath(input, item.path),
    layer: item.layer,
    reason: item.reason,
    lines: lineCount(text),
    tokens: tokenEstimate(text),
    survivesCompaction: item.survives,
    globs: item.globs,
    parent: item.parent === undefined ? undefined : displayPath(input, item.parent),
    text,
  };
};

export const resolveInstructions = (input: ResolveInput): Inventory => {
  const settings = settingsOf(input);
  const base = baseCandidates(input, settings);
  const files = withImports(input, settings, base.listed).map((item) => toFile(input, item));
  const loaded = new Set(files.map((file) => file.path));
  const firstClaude = files.find((file) => file.layer === "project")?.display ?? "CLAUDE.md";
  const shadowed: readonly ShadowedFile[] = base.shadowed
    .filter((path) => !loaded.has(toPosixPath(path)))
    .map((path) => ({ path: toPosixPath(path), display: displayPath(input, path), by: firstClaude }));
  return { files, shadowed };
};
