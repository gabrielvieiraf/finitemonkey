import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import type { ConceptSuggester } from "./concepts.js";
import type { ClaimSplitter } from "./split.js";
import { type Appended, appendEntry } from "./store.js";
import type { JudgeClaimKind } from "./types.js";
import type { SupportProposer, Verifier, VerifyRuntime } from "./verify.js";

export type JudgeRuntime = VerifyRuntime & Pick<Runtime, "appendText" | "mkdir" | "writeAtomic" | "remove">;

export interface JudgeDeps {
  readonly runtime: JudgeRuntime;
  readonly paths: FmPaths;
  readonly splitter?: ClaimSplitter;
  readonly proposer?: SupportProposer;
  readonly suggester?: ConceptSuggester;
  readonly verifiers?: Readonly<Partial<Record<JudgeClaimKind, Verifier>>>;
}

export const appendNow = (deps: JudgeDeps, record: JsonObject): Appended =>
  appendEntry(deps.runtime, deps.paths, { at: deps.runtime.now(), ...record });
