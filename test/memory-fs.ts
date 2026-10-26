import { posix } from "node:path";

import type { AbsolutePath } from "../src/core/brand.js";
import { accept, type Parsed, reject } from "../src/core/parsed.js";
import { toPosixPath } from "../src/core/posix-path.js";
import type { FileStat, LockOptions, ReleaseLock, Runtime } from "../src/core/runtime.js";

type FsRuntime = Pick<
  Runtime,
  | "readText"
  | "stat"
  | "listDir"
  | "walkFiles"
  | "writeText"
  | "writeAtomic"
  | "rename"
  | "mkdir"
  | "remove"
  | "lock"
  | "now"
>;

export interface MemoryFs extends FsRuntime {
  readonly files: () => Readonly<Record<string, string>>;
  readonly read: (path: string) => string | undefined;
  readonly writes: () => number;
  readonly failWritesTo: (path: string, code?: string) => void;
  readonly tick: (ms: number) => void;
}

export const DEFAULT_NOW = "2026-10-25T12:00:00.000Z";

export const fakeKey = (path: string): string => toPosixPath(path);

const parentsOf = (path: string): readonly string[] => {
  const parents: string[] = [];
  let current = posix.dirname(path);
  while (current !== posix.dirname(current)) {
    parents.push(current);
    current = posix.dirname(current);
  }
  return parents;
};

const prefixOf = (dir: string): string => (dir.endsWith("/") ? dir : `${dir}/`);

interface State {
  readonly files: Map<string, { content: string; mtimeMs: number }>;
  readonly dirs: Set<string>;
  clock: number;
  writes: number;
  failing: string | undefined;
  failCode: string;
}

const putFile = (state: State, path: string, content: string): void => {
  for (const parent of parentsOf(path)) state.dirs.add(parent);
  state.files.set(path, { content, mtimeMs: state.clock });
};

const statOf = (state: State, path: string): FileStat | undefined => {
  const file = state.files.get(path);
  if (file !== undefined) return { kind: "file", mtimeMs: file.mtimeMs };
  return state.dirs.has(path) ? { kind: "dir", mtimeMs: state.clock } : undefined;
};

const childrenOf = (state: State, dir: string): readonly string[] => {
  const prefix = prefixOf(dir);
  const names = [...state.files.keys(), ...state.dirs]
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length).split("/")[0] ?? "");
  return [...new Set(names)].filter((name) => name !== "").sort();
};

const walkOf = (state: State, root: string): readonly string[] => {
  const prefix = prefixOf(root);
  return [...state.files.keys()]
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .sort();
};

const removePath = (state: State, path: string): void => {
  const prefix = prefixOf(path);
  state.files.delete(path);
  state.dirs.delete(path);
  for (const file of [...state.files.keys()]) if (file.startsWith(prefix)) state.files.delete(file);
  for (const dir of [...state.dirs]) if (dir.startsWith(prefix)) state.dirs.delete(dir);
};

const write = (state: State, path: string, content: string): Parsed<undefined> => {
  if (state.failing !== undefined && path === state.failing) return reject(`${state.failCode}: ${path}`);
  if (statOf(state, path)?.kind === "dir") return reject(`EISDIR: ${path}`);
  state.writes += 1;
  putFile(state, path, content);
  return accept(undefined);
};

const lockWith =
  (state: State) =>
  (path: AbsolutePath, options: LockOptions): Parsed<ReleaseLock> => {
    const key = fakeKey(path);
    const held = state.files.get(key);
    if (held !== undefined && state.clock - held.mtimeMs <= options.staleMs) return reject(`locked: ${path}`);
    putFile(state, key, options.owner);
    return accept(() => {
      state.files.delete(key);
    });
  };

const renameWith =
  (state: State) =>
  (from: AbsolutePath, to: AbsolutePath): Parsed<undefined> => {
    const file = state.files.get(fakeKey(from));
    if (file === undefined) return reject(`ENOENT: ${from}`);
    state.files.delete(fakeKey(from));
    putFile(state, fakeKey(to), file.content);
    return accept(undefined);
  };

const addDir = (state: State, path: string): void => {
  state.dirs.add(path);
  for (const parent of parentsOf(path)) state.dirs.add(parent);
};

const fsOf = (state: State): FsRuntime => ({
  readText: (path) => {
    const file = state.files.get(fakeKey(path));
    return file === undefined ? reject(`ENOENT: ${path}`) : accept(file.content);
  },
  stat: (path) => statOf(state, fakeKey(path)),
  listDir: (path) => {
    const key = fakeKey(path);
    const names = childrenOf(state, key);
    return state.dirs.has(key) || names.length > 0 ? accept(names) : reject(`ENOENT: ${path}`);
  },
  walkFiles: (root) => accept(walkOf(state, fakeKey(root))),
  writeText: (path, text) => {
    const written = write(state, fakeKey(path), text);
    return written.ok ? accept(true) : written;
  },
  writeAtomic: (path, content) => write(state, fakeKey(path), content),
  rename: renameWith(state),
  mkdir: (path) => {
    addDir(state, fakeKey(path));
    return accept(undefined);
  },
  remove: (path) => {
    removePath(state, fakeKey(path));
    return accept(undefined);
  },
  lock: lockWith(state),
  now: () => new Date(state.clock).toISOString(),
});

export const memoryFs = (
  seed: Readonly<Record<string, string>> = {},
  dirs: readonly string[] = [],
  now: string = DEFAULT_NOW,
): MemoryFs => {
  const state: State = {
    files: new Map(),
    dirs: new Set(),
    clock: Date.parse(now),
    writes: 0,
    failing: undefined,
    failCode: "EIO",
  };
  for (const [path, content] of Object.entries(seed)) putFile(state, fakeKey(path), content);
  for (const dir of dirs) addDir(state, fakeKey(dir));
  return {
    ...fsOf(state),
    files: () => Object.fromEntries([...state.files].map(([path, file]) => [path, file.content])),
    read: (path) => state.files.get(fakeKey(path))?.content,
    writes: () => state.writes,
    failWritesTo: (path, code = "EIO") => {
      state.failing = fakeKey(path);
      state.failCode = code;
    },
    tick: (ms) => {
      state.clock += ms;
    },
  };
};
