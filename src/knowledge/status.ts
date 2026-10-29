import type { Anchor, ReadFile } from "./anchor.js";
import { anchorState, relocate } from "./anchor.js";
import { type Claim, lastOf } from "./claims.js";

export const CLAIM_STATUSES = ["valid", "stale", "closed"] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export interface AnchorReport {
  readonly anchor: Anchor;
  readonly state: "same" | "changed" | "missing" | "moved";
}

export interface ClaimView {
  readonly claim: Claim;
  readonly status: ClaimStatus;
  readonly anchors: readonly AnchorReport[];
  readonly reason?: string;
}

export interface EvaluateOptions {
  readonly read: ReadFile;
  readonly candidates: () => readonly string[];
}

const report = (anchor: Anchor, options: EvaluateOptions): AnchorReport => {
  const state = anchorState(anchor, options.read(anchor.path));
  if (state !== "missing") return { anchor, state };
  const moved = relocate(anchor, options.candidates(), options.read);
  return moved === undefined ? { anchor, state } : { anchor: moved, state: "moved" };
};

export const evaluateClaim = (claim: Claim, options: EvaluateOptions): ClaimView => {
  const anchors = claim.anchors.map((anchor) => report(anchor, options));
  if (lastOf(claim, ["close"]) !== undefined) return { claim, status: "closed", anchors, reason: "closed" };
  const broken = anchors.find((item) => item.state === "changed" || item.state === "missing");
  if (broken !== undefined) return { claim, status: "stale", anchors, reason: `${broken.state}:${broken.anchor.path}` };
  return { claim, status: "valid", anchors };
};

export const memoCandidates = (list: () => readonly string[]): (() => readonly string[]) => {
  let cached: readonly string[] | undefined;
  return () => {
    cached ??= list();
    return cached;
  };
};
