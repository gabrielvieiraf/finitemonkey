import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom } from "../core/result.js";
import type { Params } from "../i18n/translate.js";
import { type Claim, readClaims } from "../knowledge/claims.js";
import type { ClaimView } from "../knowledge/status.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
export const CLAIMS_SCHEMA = "finitemonkey/claims@1";

export const ADD_USAGE =
  'finitemonkey claims add "<text>" --anchor <path>[#<symbol>] [--check "<command>"] [--origin person|agent|external] [--evidence <task>:<n>] [--prompt <at>] [--session <id>]';

export const fail = (
  ctx: Ctx,
  key:
    | "knowledge.claims.error.usage"
    | "knowledge.claims.error.anchor"
    | "knowledge.claims.error.unknown"
    | "knowledge.claims.error.premise"
    | "knowledge.claims.error.instruction"
    | "knowledge.claims.error.person",
  usage: string,
  params: Params = {},
): CommandResult => failureFrom(ctx.t, { ...usageProblem("invalid_arguments", key, usage), params });

export const viewLine = (ctx: Ctx, view: ClaimView): string =>
  ctx.t("knowledge.claims.row", {
    id: view.claim.id,
    status: `${view.status}, ${ctx.t(view.claim.kind === "check" ? "knowledge.claims.checked" : "knowledge.claims.unverified")}`,
    text: view.claim.text,
    where: view.anchors.map((item) => item.anchor.path).join(", "),
  });

export const withClaim = (
  ctx: Ctx,
  id: string,
  run: (paths: FmPaths, claim: Claim) => CommandResult,
): Promise<CommandResult> =>
  inGuardianRepo(ctx, (root) => {
    const paths = fmPaths(root);
    const claim = readClaims(ctx.runtime, paths).find((item) => item.id === id);
    return claim === undefined
      ? fail(ctx, "knowledge.claims.error.unknown", "finitemonkey claims list", { id })
      : run(paths, claim);
  });
