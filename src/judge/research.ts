import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { appendClaimEvent, claimId } from "../knowledge/claims.js";
import { greenAfter, instructionLines } from "../knowledge/quarantine.js";
import { dataBlock } from "../policy/untrusted.js";
import { claimsIn, lastSupport } from "./claims.js";
import { appendNow, type JudgeDeps } from "./deps.js";
import type { JudgeRequest } from "./request.js";
import { type JudgeResponse, response } from "./response.js";
import { contentHash } from "./span.js";
import { judgeDir, readEntries } from "./store.js";
import type { JudgeEntry } from "./types.js";

export const RESEARCH_QUARANTINE_FEATURE = "research-quarantine";
export const ITEMS_DIR = "items";

export interface ItemView {
  readonly item: string;
  readonly origin: string;
  readonly source: string;
  readonly hash: string;
  readonly instructions: number;
  readonly data: string;
}

export const itemPath = (deps: Pick<JudgeDeps, "paths">, hash: string): string =>
  join(judgeDir(deps.paths), ITEMS_DIR, `${hash}.txt`);

export const readItem = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "read" }>): JudgeResponse => {
  const hash = contentHash(request.content);
  const id = `i-${hash}`;
  deps.runtime.mkdir(toAbsolutePath(join(judgeDir(deps.paths), ITEMS_DIR)));
  deps.runtime.writeAtomic(toAbsolutePath(itemPath(deps, hash)), request.content);
  const instructions = instructionLines(request.content.replace(/<[^>]+>/g, "\n")).length;
  const written = appendNow(deps, {
    type: "item",
    id,
    origin: `${request.origin}:${request.source}`,
    hash,
    instructions,
    synthesis: false,
  });
  if (!written.ok) return response("read", { reason: written.reason });
  const item: ItemView = {
    item: id,
    origin: request.origin,
    source: request.source,
    hash,
    instructions,
    data: dataBlock(request.source, request.content),
  };
  return response("read", { entry: id, item });
};

const promotionBlock = (deps: JudgeDeps, wanted: string, entries: readonly JudgeEntry[]): string | undefined => {
  const claim = claimsIn(entries).find((item) => item.id === wanted);
  if (claim === undefined) return "unknown_claim";
  if (instructionLines(claim.text).length > 0) return "instruction_shaped";
  const support = lastSupport(claim.id, entries);
  const spanChecked =
    support?.state === "machine-verified" && (support.anchors ?? []).some((anchor) => anchor.kind === "span");
  if (!spanChecked) return "no_span_check";
  return greenAfter(deps.runtime, deps.paths, support.at) ? undefined : "no_green_task";
};

export const promote = (deps: JudgeDeps, request: Extract<JudgeRequest, { verb: "promote" }>): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const blocked = promotionBlock(deps, request.claim, entries);
  const claim = claimsIn(entries).find((item) => item.id === request.claim);
  if (blocked !== undefined || claim === undefined) return response("promote", { reason: blocked ?? "unknown_claim" });
  const at = deps.runtime.now();
  const id = claimId(claim.text, at);
  appendClaimEvent(deps.runtime, deps.paths, {
    event: "add",
    id,
    recordedAt: at,
    text: claim.text,
    kind: "prose",
    anchors: [],
    origin: { source: "external", attributedTo: "tool", derivedFrom: { evidence: claim.id } },
  });
  return response("promote", { entry: id });
};
