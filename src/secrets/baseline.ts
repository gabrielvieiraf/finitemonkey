import {
  type Baseline,
  type BaselineEntry,
  type InScope,
  ratchetFor,
  type RatchetResult,
  SECRETS_CHECK,
} from "../findings/baseline.js";
import type { LocatedFinding } from "./located.js";

export {
  type Baseline,
  BASELINE_FILE,
  type BaselineEntry,
  type BaselineState,
  EMPTY_BASELINE,
  EXCEPTION_MAX_DAYS,
  type InScope,
  loadBaseline,
  parseBaseline,
  saveBaseline,
  withoutFixed,
} from "../findings/baseline.js";

export type SecretsRatchet = RatchetResult<LocatedFinding>;

export const ratchet = (
  findings: readonly LocatedFinding[],
  baseline: Baseline,
  now: string,
  inScope: InScope | undefined,
): RatchetResult<LocatedFinding> => ratchetFor(SECRETS_CHECK, findings, baseline, now, inScope);

export const acceptedFingerprints = (baseline: Baseline, now: string): ReadonlySet<string> =>
  new Set(
    baseline.entries
      .filter((entry: BaselineEntry) => entry.check === SECRETS_CHECK && entry.expiresAt >= now)
      .map((entry) => entry.fingerprint),
  );
