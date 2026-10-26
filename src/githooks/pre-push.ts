import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import { type Repo, repoFacts } from "../git/repo.js";
import { commitMessagesInRange, type HookCheck, mergesInRange, secretsInRange } from "./checks.js";

export interface PushUpdate {
  readonly localRef: string;
  readonly localSha: string;
  readonly remoteRef: string;
  readonly remoteSha: string;
}

const ZERO = /^0+$/;

export const parsePushUpdates = (stdin: string): readonly PushUpdate[] =>
  stdin
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([localRef, localSha, remoteRef, remoteSha]) =>
      localRef === undefined || localSha === undefined || remoteRef === undefined || remoteSha === undefined
        ? []
        : [{ localRef, localSha, remoteRef, remoteSha }],
    );

export const updatesFromEnv = (env: Env): readonly PushUpdate[] => {
  const from = env["PRE_COMMIT_FROM_REF"];
  const to = env["PRE_COMMIT_TO_REF"];
  if (from === undefined || to === undefined || from === "" || to === "") return [];
  const branch = env["PRE_COMMIT_REMOTE_BRANCH"] ?? "";
  return [{ localRef: to, localSha: to, remoteRef: branch, remoteSha: from }];
};

const branchOf = (ref: string): string => ref.replace(/^refs\/heads\//, "");

const isDeletion = (update: PushUpdate): boolean => ZERO.test(update.localSha);

const isNewRef = (update: PushUpdate): boolean => ZERO.test(update.remoteSha);

export const rangeOf = (update: PushUpdate, remote: string): readonly string[] =>
  isNewRef(update) ? [update.localSha, "--not", `--remotes=${remote}`] : [`${update.remoteSha}..${update.localSha}`];

const rewrites = (runtime: Runtime, repo: Repo, update: PushUpdate): boolean =>
  !isNewRef(update) &&
  !isDeletion(update) &&
  !runtime.git(["merge-base", "--is-ancestor", update.remoteSha, update.localSha], repo.root).ok;

const protectedCheck = (runtime: Runtime, repo: Repo, updates: readonly PushUpdate[]): HookCheck => {
  const facts = repoFacts(runtime, repo);
  const failures = updates.flatMap((update) => {
    const branch = branchOf(update.remoteRef);
    if (!update.remoteRef.startsWith("refs/heads/") || !facts.isProtected(branch)) return [];
    if (isDeletion(update)) return [`deletes protected branch ${branch}`];
    return rewrites(runtime, repo, update) ? [`rewrites protected branch ${branch} (force push)`] : [];
  });
  return { id: "protected", failures, fix: "push to a new branch and open a pull request" };
};

const merged = (id: HookCheck["id"], fix: string, checks: readonly HookCheck[]): HookCheck => ({
  id,
  fix,
  failures: [...new Set(checks.flatMap((check) => check.failures))],
});

export const prePushChecks = (
  runtime: Runtime,
  repo: Repo,
  remote: string,
  updates: readonly PushUpdate[],
): readonly HookCheck[] => {
  const pushed = updates.filter((update) => !isDeletion(update));
  const ranges = pushed.map((update) => rangeOf(update, remote));
  const secrets = ranges.map((range) => secretsInRange(runtime, repo.root, range));
  const messages = ranges.map((range) => commitMessagesInRange(runtime, repo.root, range));
  const merges = ranges.map((range) => mergesInRange(runtime, repo, range));
  return [
    protectedCheck(runtime, repo, updates),
    merged("secrets", "finitemonkey secrets scan --history", secrets),
    merged("commit-messages", "git rebase -i <base> and reword the listed commits", messages),
    merged("merges", "finitemonkey merge verify <merge-commit>", merges),
  ];
};
