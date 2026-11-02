import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { type AcceptedFile, type Approval, bindAccepted, readApprovals } from "../../guards/release/grants.js";
import { sha256Hex } from "../../secrets/fingerprint.js";
import { type CheckOutcome, failed, type GateContext, note } from "../types.js";

export const ABSENT = "absent";

export const fileHash = (ctx: Pick<GateContext, "runtime" | "paths">, path: string): string => {
  const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, path)));
  return text.ok ? sha256Hex(text.value) : ABSENT;
};

const acceptedList = (ctx: GateContext, approval: Approval, files: readonly string[]): readonly AcceptedFile[] => {
  if (approval.accepted !== undefined) return approval.accepted;
  const accepted = files.map((path) => ({ path, hash: fileHash(ctx, path) }));
  bindAccepted(ctx.runtime, ctx.paths, approval, accepted);
  return accepted;
};

const notAccepted = (ctx: GateContext, accepted: readonly AcceptedFile[], file: string): string | undefined => {
  const entry = accepted.find((item) => item.path === file);
  if (entry === undefined) return "gate.diff.not_accepted";
  return entry.hash === fileHash(ctx, file) ? undefined : "gate.diff.changed_since_accepted";
};

export const acceptedOutside = (
  ctx: GateContext,
  files: readonly string[],
  maxListed: number,
): CheckOutcome | undefined => {
  const approval = readApprovals(ctx.runtime, ctx.paths).findLast(
    (item) => item.task === ctx.contract.id && item.check === "diff",
  );
  if (approval === undefined) return undefined;
  const accepted = acceptedList(ctx, approval, files);
  const open = files.flatMap((file) => {
    const key = notAccepted(ctx, accepted, file);
    return key === undefined ? [] : [{ file, key }];
  });
  if (open.length > 0)
    return failed(
      open
        .slice(0, maxListed)
        .map((item) => note(item.key, { file: item.file, at: approval.at, task: ctx.contract.id })),
    );
  return {
    status: "passed",
    notes: files.map((file) => note("gate.diff.accepted", { file, reason: approval.reason, at: approval.at })),
    releasedBy: `person@${approval.at}`,
  };
};
