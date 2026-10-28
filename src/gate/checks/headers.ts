import { HEADERS_FEATURE, readHeaders } from "../../headers/record.js";
import { curlHeaders, loadHeadersConfig } from "../../headers/remote.js";
import { missingHeaders, type RouteHeaders } from "../../headers/rules.js";
import { readLevel } from "../../infra/file.js";
import { loadLookConfig } from "../../look/config.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 15;
export const BLOCKING_LEVEL = 2;

interface Source {
  readonly routes: readonly RouteHeaders[];
  readonly https: boolean;
}

const source = (ctx: GateContext): Source | CheckOutcome => {
  const config = loadHeadersConfig(ctx.runtime, ctx.paths.root);
  if (config.url !== undefined) {
    const routes =
      config.routes.length > 0 ? config.routes : (loadLookConfig(ctx.runtime, ctx.paths.root)?.routes ?? ["/"]);
    const read = curlHeaders(ctx.runtime, ctx.paths.root, config.url, routes, process.platform);
    if (!read.ok)
      return unverified("network", [
        note("gate.headers.unreachable", { route: read.route, detail: ctx.mask(read.detail) }),
      ]);
    return { routes: read.routes, https: config.url.startsWith("https://") };
  }
  const recorded = readHeaders(ctx.runtime, ctx.paths, ctx.treeHash);
  return recorded ?? failed([note("gate.headers.not_run")]);
};

export const headersCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, HEADERS_FEATURE);
  if (mode === "off") return passed([note("gate.headers.off")]);
  const level = readLevel(ctx.runtime, ctx.paths.root)?.level ?? 0;
  const found = source(ctx);
  if ("status" in found)
    return level < BLOCKING_LEVEL && found.status === "failed"
      ? passed([...found.notes, note("gate.headers.warn_only", { level })])
      : found;
  const issues = missingHeaders(found.routes, found.https);
  if (issues.length === 0) return passed([note("gate.headers.ok", { count: found.routes.length })]);
  const notes = issues
    .slice(0, MAX_LISTED)
    .map((issue) => note(`gate.headers.missing.${issue.rule}`, { route: issue.route }));
  if (level < BLOCKING_LEVEL) return passed([note("gate.headers.warn_only", { level }), ...notes]);
  return mode === "shadow" ? passed([note("gate.headers.shadow"), ...notes]) : failed(notes);
};
