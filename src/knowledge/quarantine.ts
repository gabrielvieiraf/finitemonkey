import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { GATE_CHECK } from "../evidence/types.js";
import { featureMode } from "../policy/feature.js";
import { UNTRUSTED_FILE } from "../policy/untrusted.js";
import type { FmPaths } from "../task/paths.js";
import { appendClaimEvent, type Claim, lastOf } from "./claims.js";
import type { ClaimView } from "./status.js";

export const MEMORY_QUARANTINE_FEATURE = "memory-quarantine";
export const CLAIM_PROMOTION_FEATURE = "claim-promotion";
export const UNTRUSTED_WINDOW_MS = 24 * 3_600_000;

const INSTRUCTION =
  /(?:^|[.!?:]\s+|^\s*(?:[-*+]|\d+[.)])\s+)(?:always|never|ignore|disregard|forget|override|run|execute|install|curl|wget|you must|you should|do not|don't|please run|sempre|nunca|ignore|execute|rode|siempre|ignora|ejecuta)\b/i;

export const instructionLines = (text: string): readonly string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && INSTRUCTION.test(line));

export const recentUntrusted = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths): string | undefined => {
  const text = runtime.readText(paths.cache(UNTRUSTED_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return undefined;
  const { tool, at } = parsed.value;
  const age = Date.parse(runtime.now()) - Date.parse(typeof at === "string" ? at : "");
  return Number.isFinite(age) && age <= UNTRUSTED_WINDOW_MS && typeof tool === "string" ? tool : undefined;
};

export const greenAfter = (
  runtime: Pick<Runtime, "readText" | "homeDir" | "listDir">,
  paths: FmPaths,
  at: string,
): boolean => {
  const listed = runtime.listDir(toAbsolutePath(join(paths.dir, "evidence")));
  const files = listed.ok ? listed.value.filter((name) => name.endsWith(".jsonl")) : [];
  const since = Date.parse(at);
  return files.some((name) =>
    readLedger(runtime, paths.evidence(name.replace(/\.jsonl$/, ""))).some(
      (entry) => entry.check === GATE_CHECK && entry.status === "passed" && Date.parse(entry.at) > since,
    ),
  );
};

const promoted = (claim: Claim): boolean => lastOf(claim, ["promote"]) !== undefined;

export type QuarantineRuntime = Pick<Runtime, "readText" | "homeDir" | "listDir">;

export const withQuarantine = (
  runtime: QuarantineRuntime,
  paths: FmPaths,
  views: readonly ClaimView[],
  ledgers = true,
): readonly ClaimView[] => {
  const mode = featureMode(runtime, paths, MEMORY_QUARANTINE_FEATURE);
  if (mode === "off") return views;
  const promotion = featureMode(runtime, paths, CLAIM_PROMOTION_FEATURE) === "active";
  return views.map((view): ClaimView => {
    const { claim } = view;
    if (claim.origin.source === "person" || promoted(claim) || view.status !== "valid") return view;
    if (claim.origin.source === "external")
      return { ...view, status: "quarantined", reason: "external origin; a person promotes it" };
    if (!promotion || (ledgers && greenAfter(runtime, paths, claim.recordedAt))) return view;
    return { ...view, status: "quarantined", reason: "waiting for a task that ends green" };
  });
};

export const settlePromotions = (
  runtime: QuarantineRuntime & Pick<Runtime, "appendText" | "mkdir" | "now">,
  paths: FmPaths,
  views: readonly ClaimView[],
): void => {
  for (const view of views) {
    const { claim } = view;
    if (
      view.status !== "valid" ||
      promoted(claim) ||
      claim.origin.source === "person" ||
      claim.origin.source === "external"
    )
      continue;
    if (!greenAfter(runtime, paths, claim.recordedAt)) continue;
    appendClaimEvent(runtime, paths, {
      event: "promote",
      id: claim.id,
      recordedAt: runtime.now(),
      reason: "used_green",
    });
  }
};
