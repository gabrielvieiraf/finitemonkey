import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { type ApiFinding, apiFindings, PYTHON, UNTYPED_JS } from "../../deps/api-version.js";
import { logEvent } from "../../evidence/log.js";
import { retrieve, RETRIEVE_FEATURE } from "../../knowledge/retrieve.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

export const API_VERSION_FEATURE = "api-version";
const MAX_LISTED = 12;
const MAX_SITE_QUERIES = 3;
const MAX_SITES = 5;
const SITE_BUDGET = 200;
const BLOCKING: ReadonlySet<ApiFinding["kind"]> = new Set(["missing", "arity", "keyword"]);

export const touchesUntypedCode = (paths: readonly string[]): boolean =>
  paths.some((path) => UNTYPED_JS.test(path) || PYTHON.test(path));

const findingNote = (finding: ApiFinding) =>
  note(`gate.api_version.${finding.kind}`, {
    at: finding.file,
    symbol: `${finding.pkg}.${finding.symbol}`,
    version: finding.version === "" ? "?" : finding.version,
    detail: finding.detail,
  });

const callSites = (ctx: GateContext, findings: readonly ApiFinding[]) => {
  if (featureMode(ctx.runtime, ctx.paths, RETRIEVE_FEATURE) === "off") return [];
  const symbols = [
    ...new Set(findings.filter((finding) => BLOCKING.has(finding.kind)).map((finding) => finding.symbol)),
  ].slice(0, MAX_SITE_QUERIES);
  return symbols.flatMap((symbol) => {
    const spans = retrieve(ctx.runtime, ctx.paths, symbol, { budget: SITE_BUDGET }).spans.filter((span) =>
      span.text.includes(symbol),
    );
    const sites = spans.slice(0, MAX_SITES).map((span) => span.anchor);
    return sites.length === 0 ? [] : [note("gate.api_version.sites", { symbol, sites: sites.join(", ") })];
  });
};

export const apiVersionCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, API_VERSION_FEATURE);
  if (mode === "off") return passed([note("gate.api_version.off")]);
  const files = ctx.changes
    .filter((change) => change.status !== "D" && touchesUntypedCode([change.path]))
    .flatMap((change) => {
      const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, change.path)));
      return text.ok ? [{ path: change.path, text: text.value }] : [];
    });
  const findings = apiFindings(ctx.runtime, ctx.paths.root, files);
  logEvent(ctx.runtime, ctx.paths, "api_version.checked", {
    files: files.length,
    findings: findings.length,
    uncertain: findings.filter((finding) => finding.kind === "uncertain").length,
  });
  if (findings.length === 0) return passed([note("gate.api_version.ok", { count: files.length })]);
  const notes = [...findings.slice(0, MAX_LISTED).map(findingNote), ...callSites(ctx, findings)];
  if (mode === "shadow") return passed([note("gate.api_version.shadow", { count: findings.length }), ...notes]);
  if (findings.some((finding) => BLOCKING.has(finding.kind))) return failed(notes);
  return findings.some((finding) => finding.kind === "not_verified")
    ? unverified("tool_missing", notes)
    : passed(notes);
};
