import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { success } from "../core/result.js";
import { gitAt, headSha, treeHash } from "../gate/git.js";
import { anchorAt, diskReader } from "../knowledge/anchor.js";
import { asOf } from "../knowledge/asof.js";
import { appendClaimEvent, type Claim } from "../knowledge/claims.js";
import { settlePromotions } from "../knowledge/quarantine.js";
import { outDecisions, settleRetractions } from "../knowledge/retraction.js";
import { viewsOf } from "../knowledge/service.js";
import { whyChain } from "../knowledge/why.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { claimsAddCommand } from "./claims-add.js";
import { CLAIMS_SCHEMA, fail, viewLine, withClaim } from "./claims-shared.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export { CLAIMS_SCHEMA } from "./claims-shared.js";

export const claimsListCommand: CommandSpec = {
  path: ["claims", "list"],
  summaryKey: "command.claims_list.summary",
  usage: "finitemonkey claims list",
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const views = viewsOf(ctx.runtime, paths);
      settleRetractions(ctx.runtime, paths, views);
      settlePromotions(ctx.runtime, paths, views);
      const decisions = outDecisions(ctx.runtime, paths);
      return success(
        {
          schema: CLAIMS_SCHEMA,
          claims: views.map((view) => ({
            id: view.claim.id,
            text: view.claim.text,
            kind: view.claim.kind,
            verified: view.claim.kind === "check",
            status: view.status,
            ...(view.reason === undefined ? {} : { reason: view.reason }),
            anchors: view.anchors.map((item) => ({ ...item.anchor, state: item.state })),
            origin: view.claim.origin,
            recordedAt: view.claim.recordedAt,
          })),
          decisions,
        },
        [
          ...(views.length === 0 ? [ctx.t("knowledge.claims.empty")] : views.map((view) => viewLine(ctx, view))),
          ...decisions.map((item) => ctx.t("knowledge.claims.decision_out", { ...item })),
        ],
      );
    }),
};

export const claimsWhyCommand: CommandSpec = {
  path: ["claims", "why"],
  summaryKey: "command.claims_why.summary",
  usage: "finitemonkey claims why <id>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const id = args.positionals[0]?.trim() ?? "";
    if (id === "") return Promise.resolve(fail(ctx, "knowledge.claims.error.usage", "finitemonkey claims why <id>"));
    return withClaim(ctx, id, (paths) => {
      const view = viewsOf(ctx.runtime, paths).find((item) => item.claim.id === id);
      const status =
        view === undefined
          ? []
          : [
              {
                depth: 0,
                label: "status",
                detail: `${view.status}${view.reason === undefined ? "" : `: ${view.reason}`}`,
              },
            ];
      const chain = [...status, ...whyChain(ctx.runtime, paths, id)];
      return success(
        { schema: CLAIMS_SCHEMA, id, chain },
        chain.map((step) => `${"  ".repeat(step.depth)}${step.label}: ${step.detail}`),
      );
    });
  },
};

export const claimsAsofCommand: CommandSpec = {
  path: ["claims", "asof"],
  summaryKey: "command.claims_asof.summary",
  usage: "finitemonkey claims asof <commit>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const commit = args.positionals[0]?.trim() ?? "";
    if (commit === "")
      return Promise.resolve(fail(ctx, "knowledge.claims.error.usage", "finitemonkey claims asof <commit>"));
    return inGuardianRepo(ctx, (root) => {
      const rows = asOf(ctx.runtime, fmPaths(root), commit);
      return success(
        { schema: CLAIMS_SCHEMA, commit, claims: rows },
        rows.length === 0
          ? [ctx.t("knowledge.claims.empty")]
          : rows.map((row) =>
              ctx.t(row.known ? "knowledge.claims.asof.known" : "knowledge.claims.asof.later", {
                id: row.id,
                status: row.status,
                text: row.text,
              }),
            ),
      );
    });
  },
};

const recorded = (
  ctx: Ctx,
  paths: FmPaths,
  claim: Claim,
  event: "renew" | "close",
  reason: string | undefined,
): void => {
  const read = diskReader(ctx.runtime, paths.root);
  const anchors = claim.anchors.flatMap((anchor) => {
    const content = read(anchor.path);
    return content === undefined ? [] : (anchorAt(content, anchor.path, anchor.symbol) ?? []);
  });
  const git = gitAt(ctx.runtime, paths.root);
  const tree = treeHash(git);
  const commit = headSha(git);
  appendClaimEvent(ctx.runtime, paths, {
    event,
    id: claim.id,
    recordedAt: ctx.runtime.now(),
    ...(event === "renew" ? { anchors } : {}),
    ...(reason === undefined ? {} : { reason }),
    ...(tree === undefined ? {} : { tree }),
    ...(commit === undefined ? {} : { commit }),
  });
};

export const claimsRenewCommand: CommandSpec = {
  path: ["claims", "renew"],
  summaryKey: "command.claims_renew.summary",
  usage: "finitemonkey claims renew <id>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    withClaim(ctx, args.positionals[0]?.trim() ?? "", (paths, claim) => {
      recorded(ctx, paths, claim, "renew", isPerson(ctx) ? "person" : "agent");
      return success({ schema: CLAIMS_SCHEMA, id: claim.id }, [ctx.t("knowledge.claims.renewed", { id: claim.id })]);
    }),
};

export const claimsCloseCommand: CommandSpec = {
  path: ["claims", "close"],
  summaryKey: "command.claims_close.summary",
  usage: "finitemonkey claims close <id> [--reason <text>]",
  status: "ready",
  maxPositionals: 1,
  options: { reason: { type: "string" } },
  run: (ctx, args) =>
    withClaim(ctx, args.positionals[0]?.trim() ?? "", (paths, claim) => {
      recorded(ctx, paths, claim, "close", stringOption(args.values, "reason"));
      return success({ schema: CLAIMS_SCHEMA, id: claim.id }, [ctx.t("knowledge.claims.closed", { id: claim.id })]);
    }),
};

const PROMOTE_USAGE = "finitemonkey claims promote <id>... | --all";

export const claimsPromoteCommand: CommandSpec = {
  path: ["claims", "promote"],
  summaryKey: "command.claims_promote.summary",
  usage: PROMOTE_USAGE,
  status: "ready",
  maxPositionals: 50,
  options: { all: { type: "boolean" } },
  run: (ctx, args) => {
    if (!isPerson(ctx)) return Promise.resolve(fail(ctx, "knowledge.claims.error.person", PROMOTE_USAGE));
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const all = args.values["all"] === true;
      const chosen = viewsOf(ctx.runtime, paths).filter(
        (view) => view.status === "quarantined" && (all || args.positionals.includes(view.claim.id)),
      );
      if (chosen.length === 0) return fail(ctx, "knowledge.claims.error.usage", PROMOTE_USAGE);
      for (const view of chosen)
        appendClaimEvent(ctx.runtime, paths, {
          event: "promote",
          id: view.claim.id,
          recordedAt: ctx.runtime.now(),
          reason: "person",
        });
      return success(
        {
          schema: CLAIMS_SCHEMA,
          promoted: chosen.map((view) => ({
            id: view.claim.id,
            origin: view.claim.origin.source,
            text: view.claim.text,
          })),
        },
        chosen.map((view) =>
          ctx.t("knowledge.claims.promoted", {
            id: view.claim.id,
            origin: view.claim.origin.source,
            text: view.claim.text,
          }),
        ),
      );
    });
  },
};

export const CLAIMS_COMMANDS = [
  claimsListCommand,
  claimsAddCommand,
  claimsWhyCommand,
  claimsAsofCommand,
  claimsRenewCommand,
  claimsCloseCommand,
  claimsPromoteCommand,
] as const;
