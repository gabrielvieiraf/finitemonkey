import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { type ApiFinding, apiFindings, PYTHON, UNTYPED_JS } from "../../deps/api-version.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

export const API_VERSION_FEATURE = "api-version";
const MAX_LISTED = 12;
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
  if (findings.length === 0) return passed([note("gate.api_version.ok", { count: files.length })]);
  const notes = findings.slice(0, MAX_LISTED).map(findingNote);
  if (mode === "shadow") return passed([note("gate.api_version.shadow", { count: findings.length }), ...notes]);
  if (findings.some((finding) => BLOCKING.has(finding.kind))) return failed(notes);
  return findings.some((finding) => finding.kind === "not_verified")
    ? unverified("tool_missing", notes)
    : passed(notes);
};
