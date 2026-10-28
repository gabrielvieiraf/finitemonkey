import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import {
  applyCommand,
  applyProposal,
  type GithubState,
  isProtectedOnGithub,
  readGithub,
  RULESET_PROPOSAL,
  writeCache,
  writeProposal,
} from "./ruleset.js";

export interface GithubStep {
  readonly state: GithubState | null;
  readonly proposal: string | null;
  readonly command: string | null;
  readonly applied: boolean;
}

export const githubStep = (runtime: Runtime, root: AbsolutePath, confirmed: boolean): GithubStep => {
  const state = readGithub(runtime, root);
  if (state === undefined) return { state: null, proposal: null, command: null, applied: false };
  writeCache(runtime, root, state);
  if (isProtectedOnGithub(state)) return { state, proposal: null, command: null, applied: false };
  const written = writeProposal(runtime, root);
  const command = applyCommand(state.repo);
  const applied = written && confirmed && applyProposal(runtime, root, state.repo);
  if (applied)
    writeCache(runtime, root, {
      ...state,
      rules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks", "merge_queue"],
      mergeQueue: true,
    });
  return { state, proposal: written ? RULESET_PROPOSAL : null, command, applied };
};

export const githubLines = (t: Translate, step: GithubStep): readonly string[] => {
  if (step.state === null) return [t("github.unavailable")];
  if (step.proposal === null && !step.applied)
    return [t("github.protected", { branch: step.state.defaultBranch, repo: step.state.repo })];
  if (step.applied) return [t("github.applied", { repo: step.state.repo })];
  return [
    t("github.missing", { branch: step.state.defaultBranch, repo: step.state.repo }),
    t("github.proposal", { file: step.proposal ?? "", command: step.command ?? "" }),
    t("github.local"),
  ];
};
