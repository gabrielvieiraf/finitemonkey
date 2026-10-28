import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import { type Repo, repoFacts } from "../git/repo.js";
import { ownershipCheck } from "../ownership/gate.js";
import { commitMessagesInRange, type HookCheck, mergesInRange, secretsInRange } from "./checks.js";

export const ciBase = (runtime: Runtime, repo: Repo, env: Env, base: string | undefined): string => {
  if (base !== undefined && base !== "") return base;
  const target = env["GITHUB_BASE_REF"];
  if (target !== undefined && target !== "") return `origin/${target}`;
  return `origin/${repoFacts(runtime, repo).defaultBranch()}`;
};

export const baseExists = (runtime: Runtime, repo: Repo, base: string): boolean =>
  runtime.git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], repo.root).ok;

export const ciChecks = (runtime: Runtime, repo: Repo, base: string): readonly HookCheck[] => {
  const range = [`${base}..HEAD`];
  return [
    secretsInRange(runtime, repo.root, range),
    commitMessagesInRange(runtime, repo.root, range),
    mergesInRange(runtime, repo, range),
    ownershipCheck(runtime, repo.root),
  ];
};
