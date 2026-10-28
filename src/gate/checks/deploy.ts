import { DRIFT_FEATURE, driftHosts, hostDrift, loadDriftConfig } from "../../deploy/drift.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { headSha } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const SHORT = 8;

export const deployCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, DRIFT_FEATURE);
  if (mode === "off") return passed([note("gate.deploy.off")]);
  const hosts = driftHosts(ctx.runtime, ctx.paths.root, ctx.env);
  if (hosts.length === 0) return failed([note("gate.deploy.no_host")]);
  const expected = headSha(ctx.git);
  if (expected === undefined) return unverified("no_evidence", [note("gate.prod.no_commit")]);
  const config = loadDriftConfig(ctx.runtime, ctx.paths.root);
  const results = hosts.map((host) => hostDrift(ctx.runtime, ctx.paths.root, host, config, expected));
  const notes = results.map((host) =>
    note(`gate.deploy.${host.state}`, {
      alias: host.alias,
      expected: expected.slice(0, SHORT),
      running: host.running.map((revision) => revision.slice(0, SHORT)).join(", ") || "-",
      edits: host.edits.length,
      detail: ctx.mask(host.detail ?? "-"),
    }),
  );
  if (results.some((host) => host.state === "diverged"))
    return mode === "shadow" ? passed([note("gate.deploy.shadow"), ...notes]) : failed(notes);
  if (results.some((host) => host.state !== "match")) return unverified("network", notes);
  return passed(notes);
};
