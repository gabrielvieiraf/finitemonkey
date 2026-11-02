import type { ContradictionProposer as InstructionProposer } from "../instructions/drift.js";
import type { ConceptSuggester } from "../judge/concepts.js";
import type { ContradictionProposer as ClaimProposer } from "../judge/events.js";
import type { HorizonProposer } from "../judge/horizon.js";
import type { DistractorProposer } from "../judge/probe-forms.js";
import type { ClaimSplitter } from "../judge/split.js";
import type { SupportProposer } from "../judge/verify.js";
import type { DeepSearch } from "../knowledge/retrieve.js";
import type { Critic } from "../look/critic.js";
import type { StanceProposer } from "../research/sides.js";
import { callProvider, type ProviderDeps, valueOf } from "./call.js";
import type { ProviderKind } from "./kinds.js";
import { isEnabled } from "./store.js";
import {
  concepts,
  contradictionPairs,
  helps,
  pick,
  proposal,
  recordList,
  sourceSpans,
  spans,
  stance,
  stringList,
} from "./validate.js";

export const providerSplitter =
  (deps: ProviderDeps): ClaimSplitter =>
  (text) =>
    valueOf(callProvider(deps, { kind: "claim-split", payload: { text }, validate: stringList }));

export const providerSupport =
  (deps: ProviderDeps): SupportProposer =>
  (claim) =>
    valueOf(callProvider(deps, { kind: "support", payload: { claim }, validate: proposal }));

export const providerConcepts =
  (deps: ProviderDeps): ConceptSuggester =>
  (text) =>
    valueOf(callProvider(deps, { kind: "concepts", payload: { text }, validate: concepts }));

export const providerDistractors =
  (deps: ProviderDeps): DistractorProposer =>
  (span, source) =>
    valueOf(callProvider(deps, { kind: "distractors", payload: { span, source }, validate: stringList }));

export const providerHorizon =
  (deps: ProviderDeps): HorizonProposer =>
  (subject) =>
    valueOf(callProvider(deps, { kind: "horizon", payload: { subject }, validate: helps }));

export const providerStance =
  (deps: ProviderDeps): StanceProposer =>
  (source, unknown) =>
    valueOf(callProvider(deps, { kind: "stance", payload: { source, unknown }, validate: stance }));

export const providerClaimContradictions =
  (deps: ProviderDeps): ClaimProposer =>
  (claim) =>
    valueOf(callProvider(deps, { kind: "claim-contradictions", payload: { claim }, validate: sourceSpans }));

export const providerInstructionConflicts =
  (deps: ProviderDeps): InstructionProposer =>
  (files) =>
    valueOf(
      callProvider(deps, {
        kind: "instruction-conflicts",
        payload: { files: files.map((file) => ({ path: file.path, text: file.text })) },
        validate: contradictionPairs,
      }),
    ) ?? [];

export const providerDeepSearch =
  (deps: ProviderDeps): DeepSearch =>
  (query, budget) =>
    valueOf(callProvider(deps, { kind: "retrieve-deep", payload: { query, budget }, validate: spans })) ?? [];

export const providerCritic = (deps: ProviderDeps): Critic => ({
  critique: (input) =>
    Promise.resolve(
      valueOf(
        callProvider(deps, {
          kind: "critic",
          payload: { route: input.route, viewport: input.viewport, screenshot: input.screenshot },
          validate: recordList,
        }),
      ) ?? [],
    ),
  rank: (a, b, checklist) => {
    const picked = valueOf(
      callProvider(deps, {
        kind: "critic",
        prompt: "critic-rank",
        payload: { a, b, checklist: [...checklist] },
        validate: pick,
      }),
    );
    return picked === undefined ? Promise.reject(new Error("provider gave no ranking")) : Promise.resolve(picked);
  },
});

export const whenEnabled = <T>(
  deps: ProviderDeps,
  kind: ProviderKind,
  make: (deps: ProviderDeps) => T,
): T | undefined => (isEnabled(deps.runtime, deps.paths, kind) ? make(deps) : undefined);
