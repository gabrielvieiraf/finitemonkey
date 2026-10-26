import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { GitRun, Runtime } from "../core/runtime.js";
import { isSensitivePath } from "../secrets/guards/paths.js";
import type { Repo } from "./repo.js";

export const IDENTITY_ENV = {
  GIT_AUTHOR_NAME: "finitemonkey",
  GIT_AUTHOR_EMAIL: "finitemonkey@localhost",
  GIT_COMMITTER_NAME: "finitemonkey",
  GIT_COMMITTER_EMAIL: "finitemonkey@localhost",
} as const;

export interface TreeOptions {
  readonly timeoutMs: number;
  readonly stamp: string;
}

const failure = (step: string, result: GitRun): string =>
  result.timedOut ? `${step}: timed out` : `${step}: ${result.stderr.trim() || "git failed"}`;

const run = (
  runtime: Runtime,
  repo: Repo,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  options: TreeOptions,
  input?: string,
): Parsed<string> => {
  const result = runtime.gitWith(args, repo.root, {
    env,
    timeoutMs: options.timeoutMs,
    ...(input === undefined ? {} : { input }),
  });
  return result.ok ? accept(result.stdout.trim()) : reject(failure(args[0] ?? "git", result));
};

const dropSensitive = (
  runtime: Runtime,
  repo: Repo,
  env: Readonly<Record<string, string>>,
  options: TreeOptions,
): Parsed<undefined> => {
  const listed = run(runtime, repo, ["ls-files", "-z"], env, options);
  if (!listed.ok) return listed;
  const sensitive = listed.value.split("\u0000").filter((path) => path !== "" && isSensitivePath(path));
  if (sensitive.length === 0) return accept(undefined);
  const removed = run(runtime, repo, ["rm", "--cached", "-q", "--ignore-unmatch", "--", ...sensitive], env, options);
  return removed.ok ? accept(undefined) : removed;
};

export const withTempIndex = <T>(
  runtime: Runtime,
  repo: Repo,
  options: TreeOptions,
  work: (env: Readonly<Record<string, string>>) => Parsed<T>,
): Parsed<T> => {
  const path = toAbsolutePath(join(repo.gitDir, `finitemonkey-${options.stamp}.index`));
  const env = { GIT_INDEX_FILE: path, GIT_OPTIONAL_LOCKS: "0" };
  try {
    return work(env);
  } finally {
    runtime.remove(path);
    runtime.remove(toAbsolutePath(`${path}.lock`));
  }
};

export const worktreeTree = (
  runtime: Runtime,
  repo: Repo,
  head: string | undefined,
  options: TreeOptions,
): Parsed<string> =>
  withTempIndex(runtime, repo, options, (env) => {
    const read = run(runtime, repo, head === undefined ? ["read-tree", "--empty"] : ["read-tree", head], env, options);
    if (!read.ok) return read;
    const added = run(runtime, repo, ["add", "-A", "--", ":/", ":(exclude,top).finitemonkey"], env, options);
    if (!added.ok) return added;
    const cleaned = dropSensitive(runtime, repo, env, options);
    if (!cleaned.ok) return cleaned;
    return run(runtime, repo, ["write-tree"], env, options);
  });

const STAGE_ZERO = /^\d+ [0-9a-f]+ 0\t/;

export const indexTree = (runtime: Runtime, repo: Repo, options: TreeOptions): Parsed<string> => {
  const staged = run(runtime, repo, ["ls-files", "-s", "-z"], { GIT_OPTIONAL_LOCKS: "0" }, options);
  if (!staged.ok) return staged;
  const entries = staged.value.split("\u0000").filter((entry) => STAGE_ZERO.test(entry));
  return withTempIndex(runtime, repo, { ...options, stamp: `${options.stamp}-index` }, (env) => {
    const read = run(runtime, repo, ["read-tree", "--empty"], env, options);
    if (!read.ok) return read;
    if (entries.length === 0) return run(runtime, repo, ["write-tree"], env, options);
    const info = entries.map((entry) => entry.replace(/^(\d+ [0-9a-f]+) 0\t/, "$1\t")).join("\u0000");
    const filled = run(runtime, repo, ["update-index", "-z", "--index-info"], env, options, `${info}\u0000`);
    if (!filled.ok) return filled;
    return run(runtime, repo, ["write-tree"], env, options);
  });
};

export const commitTree = (
  runtime: Runtime,
  repo: Repo,
  tree: string,
  parents: readonly string[],
  message: string,
  options: TreeOptions,
): Parsed<string> =>
  run(
    runtime,
    repo,
    ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", message],
    IDENTITY_ENV,
    options,
  );
