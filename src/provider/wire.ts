import type { UnattendedDeps } from "../autonomy/chain.js";
import type { BlindWriter } from "../blind/blind.js";
import type { Ctx } from "../core/context.js";
import { gitAt, resolveBase } from "../gate/git.js";
import type { JudgeDeps } from "../judge/deps.js";
import { commandSource } from "../ricochete/divergence.js";
import type { FmPaths } from "../task/paths.js";
import { providerConcepts, providerDistractors, providerSplitter, providerSupport, whenEnabled } from "./adapters.js";
import type { ProviderDeps } from "./call.js";
import { providerAgent, providerBlindTests, type ProviderCandidates, providerCandidates } from "./generators.js";
import { isEnabled } from "./store.js";

export const providerDeps = (ctx: Pick<Ctx, "runtime" | "env">, paths: FmPaths): ProviderDeps => ({
  runtime: ctx.runtime,
  paths,
  env: ctx.env,
});

type JudgeProposers = Pick<JudgeDeps, "splitter" | "proposer" | "suggester" | "distractors">;

export const providerJudge = (deps: ProviderDeps): JudgeProposers => {
  const splitter = whenEnabled(deps, "claim-split", providerSplitter);
  const proposer = whenEnabled(deps, "support", providerSupport);
  const suggester = whenEnabled(deps, "concepts", providerConcepts);
  const distractors = whenEnabled(deps, "distractors", providerDistractors);
  return {
    ...(splitter === undefined ? {} : { splitter }),
    ...(proposer === undefined ? {} : { proposer }),
    ...(suggester === undefined ? {} : { suggester }),
    ...(distractors === undefined ? {} : { distractors }),
  };
};

export const divergenceSource = (
  deps: ProviderDeps,
  command: string | undefined,
  base: string | undefined,
): ProviderCandidates | undefined => {
  if (command !== undefined)
    return { source: commandSource(deps.runtime, deps.paths.root, command), cleanup: () => undefined };
  if (!isEnabled(deps.runtime, deps.paths, "divergence")) return undefined;
  return providerCandidates(deps, resolveBase(gitAt(deps.runtime, deps.paths.root), base));
};

export const blindWriterOf =
  (deps: ProviderDeps) =>
  (max: number): BlindWriter =>
  (packet, dir) =>
    providerBlindTests(deps, packet, dir, max);

export const unattendedAgent = (deps: ProviderDeps): UnattendedDeps["agent"] | undefined =>
  whenEnabled(deps, "agent", providerAgent);
