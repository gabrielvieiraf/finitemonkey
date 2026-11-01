import type { Ctx } from "../core/context.js";
import { success } from "../core/result.js";
import { gitAt, headSha, treeHash } from "../gate/git.js";
import { type Anchor, anchorAt, diskReader } from "../knowledge/anchor.js";
import { appendClaimEvent, claimId } from "../knowledge/claims.js";
import { projectSyntax } from "../knowledge/syntax.js";
import { type PremiseProposal, readProposals, settleProposal } from "../premise/proposal.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { CLAIMS_SCHEMA, fail } from "./claims-shared.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

const MAX_ANCHORS = 3;
const APPROVE_USAGE = "finitemonkey claims approve <proposal>";
const REJECT_USAGE = "finitemonkey claims reject <proposal>";

const holders = (ctx: Ctx, paths: FmPaths, symbol: string): readonly string[] =>
  (gitAt(ctx.runtime, paths.root).out(["grep", "-l", "-I", "-w", "-F", "-e", symbol]) ?? "")
    .split("\n")
    .filter((file) => file !== "")
    .slice(0, MAX_ANCHORS);

export const proposalAnchors = (ctx: Ctx, paths: FmPaths, proposal: PremiseProposal): readonly Anchor[] => {
  const read = diskReader(ctx.runtime, paths.root);
  const syntax = projectSyntax(ctx.runtime, paths.root);
  const symbol = proposal.symbols[0];
  const files = proposal.files.length > 0 ? proposal.files : symbol === undefined ? [] : holders(ctx, paths, symbol);
  return files.slice(0, MAX_ANCHORS).flatMap((file) => {
    const text = read(file);
    if (text === undefined) return [];
    return (
      (symbol === undefined ? undefined : anchorAt(text, file, symbol, syntax)) ?? anchorAt(text, file, undefined) ?? []
    );
  });
};

const approve = (ctx: Ctx, paths: FmPaths, proposal: PremiseProposal, anchors: readonly Anchor[]): string => {
  const git = gitAt(ctx.runtime, paths.root);
  const tree = treeHash(git);
  const commit = headSha(git);
  const recordedAt = ctx.runtime.now();
  const id = claimId(proposal.text, recordedAt);
  appendClaimEvent(ctx.runtime, paths, {
    event: "add",
    id,
    recordedAt,
    text: proposal.text,
    kind: "check",
    run: proposal.run,
    anchors,
    origin: { source: "person", attributedTo: "person", derivedFrom: { prompt: proposal.at } },
    because: [],
    reason: `premise ${proposal.id}`,
    ...(tree === undefined ? {} : { tree }),
    ...(commit === undefined ? {} : { commit }),
  });
  settleProposal(ctx.runtime, paths, proposal.id, "approved", id);
  return id;
};

const pending = (ctx: Ctx, paths: FmPaths, id: string): PremiseProposal | undefined =>
  readProposals(ctx.runtime, paths).find((item) => item.id === id && item.state === "proposed");

export const claimsApproveCommand: CommandSpec = {
  path: ["claims", "approve"],
  summaryKey: "command.claims_approve.summary",
  usage: APPROVE_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const wanted = args.positionals[0]?.trim() ?? "";
    if (!isPerson(ctx)) return Promise.resolve(fail(ctx, "knowledge.claims.error.person", APPROVE_USAGE));
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const proposal = pending(ctx, paths, wanted);
      if (proposal === undefined)
        return fail(ctx, "knowledge.claims.error.unknown", "finitemonkey claims list", { id: wanted });
      const anchors = proposalAnchors(ctx, paths, proposal);
      if (anchors.length === 0)
        return fail(ctx, "knowledge.claims.error.anchor", APPROVE_USAGE, { anchor: proposal.files.join(", ") || "-" });
      const id = approve(ctx, paths, proposal, anchors);
      return success({ schema: CLAIMS_SCHEMA, id, proposal: proposal.id, run: proposal.run }, [
        ctx.t("knowledge.claims.approved", { id, proposal: proposal.id }),
      ]);
    });
  },
};

export const claimsRejectCommand: CommandSpec = {
  path: ["claims", "reject"],
  summaryKey: "command.claims_reject.summary",
  usage: REJECT_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const wanted = args.positionals[0]?.trim() ?? "";
    if (!isPerson(ctx)) return Promise.resolve(fail(ctx, "knowledge.claims.error.person", REJECT_USAGE));
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      if (pending(ctx, paths, wanted) === undefined)
        return fail(ctx, "knowledge.claims.error.unknown", "finitemonkey claims list", { id: wanted });
      settleProposal(ctx.runtime, paths, wanted, "rejected");
      return success({ schema: CLAIMS_SCHEMA, proposal: wanted }, [
        ctx.t("knowledge.claims.rejected", { proposal: wanted }),
      ]);
    });
  },
};
