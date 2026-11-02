import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import type { TaskContract } from "../task/types.js";

export const REVIEWER_TRUST_FILE = "reviewer-trust.json";

const AGENT_NAME = /^[A-Za-z0-9][\w.-]{0,80}$/;

export const agentFile = (agent: string): string => `.claude/agents/${agent}.md`;

export const agentDigest = (runtime: Pick<Runtime, "readText">, root: string, agent: string): string | undefined => {
  if (!AGENT_NAME.test(agent)) return undefined;
  const text = runtime.readText(toAbsolutePath(join(root, agentFile(agent))));
  return text.ok ? sha256Hex(text.value) : undefined;
};

type Digests = Readonly<Record<string, Readonly<Record<string, string>>>>;

const readDigests = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Digests => {
  const tasks = readJsonFile(runtime, paths.cache(REVIEWER_TRUST_FILE))?.["tasks"];
  if (!isRecord(tasks)) return {};
  return Object.fromEntries(
    Object.entries(tasks).map(([task, agents]) => [
      task,
      isRecord(agents)
        ? Object.fromEntries(
            Object.entries(agents).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : {},
    ]),
  );
};

export const recordReviewerTrust = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  contract: Pick<TaskContract, "id" | "reviewers">,
): boolean => {
  const agents = Object.fromEntries(
    (contract.reviewers ?? []).flatMap((agent) => {
      const digest = agentDigest(runtime, paths.root, agent);
      return digest === undefined ? [] : [[agent, digest] as const];
    }),
  );
  const tasks = { ...readDigests(runtime, paths), [contract.id]: agents };
  return writeJsonFile(runtime, paths.cache(REVIEWER_TRUST_FILE), { tasks }).ok;
};

export interface ReviewerScope {
  readonly runtime: Pick<Runtime, "readText">;
  readonly paths: FmPaths;
  readonly contract: Pick<TaskContract, "id" | "reviewers">;
  readonly trusted: boolean;
}

export const listedReviewerTrusted = (scope: ReviewerScope, agent: string): boolean => {
  if (!scope.trusted || scope.contract.reviewers?.includes(agent) !== true) return false;
  const approved = readDigests(scope.runtime, scope.paths)[scope.contract.id]?.[agent];
  return approved !== undefined && approved === agentDigest(scope.runtime, scope.paths.root, agent);
};
