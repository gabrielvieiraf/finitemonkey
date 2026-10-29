import { type CommandArgs, listOption, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { gitAt, headSha, treeHash } from "../gate/git.js";
import { anchorAt, diskReader } from "../knowledge/anchor.js";
import { asOf } from "../knowledge/asof.js";
import {
  appendClaimEvent,
  type Attribution,
  type Claim,
  claimId,
  type DerivedFrom,
  ORIGIN_SOURCES,
  type OriginSource,
  readClaims,
} from "../knowledge/claims.js";
import { viewsOf } from "../knowledge/service.js";
import type { ClaimView } from "../knowledge/status.js";
import { whyChain } from "../knowledge/why.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const CLAIMS_SCHEMA = "finitemonkey/claims@1";

const ADD_USAGE =
  'finitemonkey claims add "<text>" --anchor <path>[#<symbol>] [--check "<command>"] [--origin person|agent|external] [--evidence <task>:<n>] [--prompt <at>] [--session <id>]';

const fail = (
  ctx: Ctx,
  key: "knowledge.claims.error.usage" | "knowledge.claims.error.anchor" | "knowledge.claims.error.unknown",
  usage: string,
  params = {},
) => failureFrom(ctx.t, { ...usageProblem("invalid_arguments", key, usage), params });

const viewLine = (ctx: Ctx, view: ClaimView): string =>
  ctx.t("knowledge.claims.row", {
    id: view.claim.id,
    status: view.status,
    text: view.claim.text,
    where: view.anchors.map((item) => item.anchor.path).join(", "),
  });

const withClaim = (ctx: Ctx, id: string, run: (paths: FmPaths, claim: Claim) => CommandResult) =>
  inGuardianRepo(ctx, (root) => {
    const paths = fmPaths(root);
    const claim = readClaims(ctx.runtime, paths).find((item) => item.id === id);
    return claim === undefined
      ? fail(ctx, "knowledge.claims.error.unknown", "finitemonkey claims list", { id })
      : run(paths, claim);
  });

export const claimsListCommand: CommandSpec = {
  path: ["claims", "list"],
  summaryKey: "command.claims_list.summary",
  usage: "finitemonkey claims list",
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const views = viewsOf(ctx.runtime, fmPaths(root));
      return success(
        {
          schema: CLAIMS_SCHEMA,
          claims: views.map((view) => ({
            id: view.claim.id,
            text: view.claim.text,
            kind: view.claim.kind,
            status: view.status,
            anchors: view.anchors.map((item) => ({ ...item.anchor, state: item.state })),
            origin: view.claim.origin,
            recordedAt: view.claim.recordedAt,
          })),
        },
        views.length === 0 ? [ctx.t("knowledge.claims.empty")] : views.map((view) => viewLine(ctx, view)),
      );
    }),
};

const anchorSpec = (spec: string): { readonly path: string; readonly symbol?: string } => {
  const [path = "", symbol] = spec.split("#");
  return { path: path.replace(/^\.\//, ""), ...(symbol === undefined || symbol === "" ? {} : { symbol }) };
};

const sourceOf = (ctx: Ctx, wanted: string | undefined): OriginSource =>
  ORIGIN_SOURCES.find((item) => item === wanted) ?? (isPerson(ctx) ? "person" : "agent");

const attributionOf = (source: OriginSource): Attribution =>
  source === "person" ? "person" : source === "external" ? "tool" : "agent";

const derivedFrom = (values: CommandArgs["values"], commit: string | undefined): DerivedFrom => ({
  ...(commit === undefined ? {} : { commit }),
  ...Object.fromEntries(
    (["session", "evidence", "prompt"] as const).flatMap((key) => {
      const value = stringOption(values, key);
      return value === undefined ? [] : [[key, value]];
    }),
  ),
});

export const claimsAddCommand: CommandSpec = {
  path: ["claims", "add"],
  summaryKey: "command.claims_add.summary",
  usage: ADD_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: {
    anchor: { type: "string", multiple: true },
    check: { type: "string" },
    origin: { type: "string" },
    evidence: { type: "string" },
    prompt: { type: "string" },
    session: { type: "string" },
    because: { type: "string", multiple: true },
  },
  run: (ctx, args) => {
    const text = args.positionals[0]?.trim() ?? "";
    const specs = listOption(args.values, "anchor").map(anchorSpec);
    if (text === "" || specs.length === 0) return Promise.resolve(fail(ctx, "knowledge.claims.error.usage", ADD_USAGE));
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const read = diskReader(ctx.runtime, root);
      const anchors = specs.map((spec) => {
        const content = read(spec.path);
        return content === undefined ? undefined : anchorAt(content, spec.path, spec.symbol);
      });
      const missing = specs.find((_, index) => anchors[index] === undefined);
      if (missing !== undefined)
        return fail(ctx, "knowledge.claims.error.anchor", ADD_USAGE, {
          anchor: missing.symbol === undefined ? missing.path : `${missing.path}#${missing.symbol}`,
        });
      const git = gitAt(ctx.runtime, root);
      const commit = headSha(git);
      const tree = treeHash(git);
      const source = sourceOf(ctx, stringOption(args.values, "origin"));
      const check = stringOption(args.values, "check");
      const recordedAt = ctx.runtime.now();
      const id = claimId(text, recordedAt);
      appendClaimEvent(ctx.runtime, paths, {
        event: "add",
        id,
        recordedAt,
        text,
        kind: check === undefined ? "prose" : "check",
        ...(check === undefined ? {} : { run: check }),
        anchors: anchors.flatMap((anchor) => anchor ?? []),
        origin: {
          source,
          attributedTo: attributionOf(source),
          derivedFrom: derivedFrom(args.values, commit),
        },
        because: listOption(args.values, "because"),
        ...(tree === undefined ? {} : { tree }),
        ...(commit === undefined ? {} : { commit }),
      });
      return success({ schema: CLAIMS_SCHEMA, id }, [ctx.t("knowledge.claims.added", { id })]);
    });
  },
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
      const chain = whyChain(ctx.runtime, paths, id);
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

export const CLAIMS_COMMANDS = [
  claimsListCommand,
  claimsAddCommand,
  claimsWhyCommand,
  claimsAsofCommand,
  claimsRenewCommand,
  claimsCloseCommand,
] as const;
