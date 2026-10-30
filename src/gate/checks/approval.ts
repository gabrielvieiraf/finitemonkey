import { type Approval, bindApproval, readApprovals } from "../../guards/release/grants.js";
import type { GateContext } from "../types.js";

export type BoundApproval =
  { readonly kind: "valid"; readonly approval: Approval } | { readonly kind: "stale"; readonly approval: Approval };

export const boundApproval = (ctx: GateContext, check: string): BoundApproval | undefined => {
  const approval = readApprovals(ctx.runtime, ctx.paths).findLast(
    (item) => item.task === ctx.contract.id && item.check === check,
  );
  if (approval === undefined) return undefined;
  if (approval.treeHash === undefined) {
    bindApproval(ctx.runtime, ctx.paths, approval, ctx.treeHash);
    return { kind: "valid", approval: { ...approval, treeHash: ctx.treeHash } };
  }
  return { kind: approval.treeHash === ctx.treeHash ? "valid" : "stale", approval };
};
