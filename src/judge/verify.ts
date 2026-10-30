import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import type { SourceFetcher } from "./fetch.js";
import type { ClaimEntry, JudgeAnchor, JudgeClaimKind, JudgeEntry } from "./types.js";

export const CHECK_TIMEOUT_MS = 60_000;

export interface Verdict {
  readonly verified: boolean;
  readonly outcome: string;
  readonly ref?: string;
  readonly anchors?: readonly JudgeAnchor[];
}

export type VerifyRuntime = Pick<Runtime, "readText" | "exec" | "now">;

export interface VerifyContext {
  readonly runtime: VerifyRuntime;
  readonly paths: FmPaths;
  readonly entries: readonly JudgeEntry[];
  readonly fetcher?: SourceFetcher;
}

export type Verifier = (claim: ClaimEntry, context: VerifyContext) => Verdict;

export type SupportProposer = (claim: string) => string | undefined;

export const notVerified = (outcome: string): Verdict => ({ verified: false, outcome });

export const checkVerifier: Verifier = (claim, context) => {
  const command = claim.anchors.find((anchor) => anchor.kind === "compute")?.ref;
  if (command === undefined) return notVerified("no-check");
  const result = context.runtime.exec({
    command,
    args: [],
    cwd: context.paths.root,
    timeoutMs: CHECK_TIMEOUT_MS,
    shell: true,
    env: { CI: "1" },
  });
  if (!result.found || result.timedOut) return notVerified("not-run");
  if (result.exitCode !== 0) return notVerified("failed");
  return { verified: true, outcome: "passed", ref: sha256Hex(`${command}\u0000${result.stdout}`).slice(0, 16) };
};

export const DEFAULT_VERIFIERS: Readonly<Partial<Record<JudgeClaimKind, Verifier>>> = { check: checkVerifier };
