import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";

export const FM_DIR = ".finitemonkey";

export interface FmPaths {
  readonly root: AbsolutePath;
  readonly dir: AbsolutePath;
  readonly state: AbsolutePath;
  readonly trust: AbsolutePath;
  readonly log: AbsolutePath;
  readonly grants: AbsolutePath;
  readonly task: (id: string) => AbsolutePath;
  readonly evidence: (id: string) => AbsolutePath;
  readonly cache: (name: string) => AbsolutePath;
}

export const fmPaths = (root: AbsolutePath): FmPaths => {
  const dir = toAbsolutePath(join(root, FM_DIR));
  const at = (...parts: readonly string[]): AbsolutePath => toAbsolutePath(join(dir, ...parts));
  return {
    root,
    dir,
    state: at("state.json"),
    trust: at("trust.json"),
    log: at("log.jsonl"),
    grants: at("allow", "grants.json"),
    task: (id) => at("tasks", `${id}.yml`),
    evidence: (id) => at("evidence", `${id}.jsonl`),
    cache: (name) => at("cache", name),
  };
};
