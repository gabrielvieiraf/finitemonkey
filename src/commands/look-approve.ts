import { join } from "node:path";

import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { approveRoute, latestLayouts, latestTree } from "../look/approved.js";
import { nextDontId, readDont, writeDont } from "../look/dont.js";
import { slugOf } from "../look/node-capture.js";
import { storeApprovedImages } from "../look/node-visual.js";
import { lookDir } from "../look/paths.js";
import { approvedImagesDir, readVerdicts, type Verdict, writeVerdicts } from "../look/visual.js";
import { isPerson, personName } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const LOOK_APPROVE_SCHEMA = "finitemonkey/look-approve@1";
const USAGE = "finitemonkey look approve <route> [--reason <why>]";
const REJECT_USAGE = "finitemonkey look reject <route> --reason <why>";

const record = (ctx: Ctx, paths: FmPaths, verdict: Omit<Verdict, "by" | "at">): Verdict => {
  const full: Verdict = { ...verdict, by: personName(ctx), at: ctx.runtime.now() };
  writeVerdicts(ctx.runtime, paths, [...readVerdicts(ctx.runtime, paths), full]);
  return full;
};

const storeImages = (paths: FmPaths, tree: string, route: string, viewports: readonly number[]): void => {
  const dir = lookDir(paths, tree);
  storeApprovedImages(
    viewports.map((viewport) => ({ route, viewport, path: join(dir, `${slugOf(route)}-${String(viewport)}.png`) })),
    approvedImagesDir(paths),
  );
};

const approve = (ctx: Ctx, route: string | undefined, reason: string): CommandResult => {
  if (!route?.startsWith("/")) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: route ?? "" }),
    );
  }
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("look.approve.person_only", USAGE));
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const tree = latestTree(ctx.runtime, paths);
  const pages = latestLayouts(ctx.runtime, paths);
  const approved = approveRoute(ctx.runtime, paths, route, pages, tree === undefined ? undefined : { tree });
  if (approved.length === 0) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "look.approve.no_capture", "finitemonkey look", { route }),
    );
  }
  const viewports = approved.map((screen) => screen.viewport);
  if (tree !== undefined) {
    storeImages(paths, tree, route, viewports);
    record(ctx, paths, { route, tree, verdict: "approved", reason });
  }
  logEvent(ctx.runtime, paths, "look.approved", { route, viewports });
  return success({ schema: LOOK_APPROVE_SCHEMA, route, viewports }, [
    ctx.t("look.approve.done", { route, count: approved.length }),
  ]);
};

const reject = (ctx: Ctx, route: string | undefined, reason: string): CommandResult => {
  if (!route?.startsWith("/") || reason === "")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", REJECT_USAGE, { detail: route ?? "" }),
    );
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("look.approve.person_only", REJECT_USAGE));
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const tree = latestTree(ctx.runtime, paths);
  if (tree === undefined)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "look.approve.no_capture", "finitemonkey look", { route }),
    );
  record(ctx, paths, { route, tree, verdict: "rejected", reason });
  const rules = readDont(ctx.runtime, paths);
  const id = nextDontId(rules);
  const rule = { id, reason, by: personName(ctx), at: ctx.runtime.now(), source: `visual ${route}` };
  writeDont(ctx.runtime, paths, [...rules, rule]);
  logEvent(ctx.runtime, paths, "look.rejected", { route, tree, dont: id });
  return success({ schema: LOOK_APPROVE_SCHEMA, route, verdict: "rejected", dont: id }, [
    ctx.t("look.reject.done", { route, id }),
  ]);
};

export const lookApproveCommand: CommandSpec = {
  path: ["look", "approve"],
  summaryKey: "command.look_approve.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { reason: { type: "string" } },
  run: (ctx, args) => Promise.resolve(approve(ctx, args.positionals[0], stringOption(args.values, "reason") ?? "")),
};

export const lookRejectCommand: CommandSpec = {
  path: ["look", "reject"],
  summaryKey: "command.look_reject.summary",
  usage: REJECT_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { reason: { type: "string" } },
  run: (ctx, args) =>
    Promise.resolve(reject(ctx, args.positionals[0], stringOption(args.values, "reason")?.trim() ?? "")),
};
