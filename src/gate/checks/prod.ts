import { DEFAULT_LIVE_STATUS, loadDeployConfig } from "../../deploy/config.js";
import { readVersion, sameCommit } from "../../deploy/version.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { headSha } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const SHORT = 8;

export const prodCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const config = loadDeployConfig(ctx.runtime, ctx.paths.root);
  const url = check.versionUrl ?? config?.versionUrl;
  if (url === undefined) return failed([note("gate.prod.no_url")]);
  const expected = headSha(ctx.git);
  if (expected === undefined) return unverified("no_evidence", [note("gate.prod.no_commit")]);
  const status = check.status ?? config?.status ?? DEFAULT_LIVE_STATUS;
  const read = readVersion(ctx.runtime, ctx.paths.root, url, check.field ?? config?.field);
  if (read.kind === "unreachable")
    return unverified("network", [note("gate.prod.unreachable", { url, detail: ctx.mask(read.detail) })]);
  const params = {
    url,
    expected: expected.slice(0, SHORT),
    live: (read.commit ?? "-").slice(0, SHORT),
    status: read.status,
    want: status,
  };
  if (read.status !== status) return failed([note("gate.prod.status", params)]);
  return sameCommit(read.commit, expected)
    ? passed([note("gate.prod.live", params)])
    : failed([note("gate.prod.behind", params)]);
};
