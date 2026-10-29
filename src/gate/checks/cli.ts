import { CLI_UX_FEATURE, cliFindings, loadCliConfig } from "../../cliux/cli.js";
import { probeCli } from "../../cliux/run.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 10;

export const cliCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, CLI_UX_FEATURE);
  if (mode === "off") return passed([note("gate.cli.off")]);
  const config = loadCliConfig(ctx.runtime, ctx.paths.root);
  if (config === undefined) return passed([note("gate.cli.none")]);
  const runs = probeCli(ctx.runtime, ctx.paths.root, config);
  if (runs === undefined)
    return unverified("tool_missing", [note("gate.cli.not_found", { bin: config.bin.join(" ") })]);
  const findings = cliFindings(runs, config.firstOutputMs, config.timeoutMs);
  if (findings.length === 0) return passed([note("gate.cli.clean")]);
  const notes = findings.slice(0, MAX_LISTED).map((finding) => note(`gate.cli.${finding.kind}`, { ...finding }));
  return mode === "active" ? failed(notes) : passed([note("gate.cli.shadow", { count: findings.length }), ...notes]);
};
