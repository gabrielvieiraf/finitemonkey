import { join } from "node:path";

import { consistencyProblems } from "../apicontract/consistency.js";
import { liveConfig, liveProblems, runLive } from "../apicontract/live.js";
import { loadRegistry } from "../apicontract/load.js";
import { CONTRACT_FILE } from "../apicontract/registry.js";
import { parseShape } from "../apicontract/shape.js";
import { localSend } from "../app/node-probe.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { loadProjectConfig } from "../git/project-config.js";
import { localUrl, type Send } from "../scenarios/run.js";
import { projectRoot } from "../secrets/project.js";
import { withApp } from "./scenarios.js";

export const LIVE_CONFIG_HINT = "add api: port (and start, base) to .finitemonkey/config.yml";

export type SendFor = (port: number) => Send;

const defaultSend: SendFor = (port) => localSend((path) => localUrl(port, path));

export const runContractLive = async (
  ctx: Ctx,
  schema: string,
  usage: string,
  sendFor: SendFor = defaultSend,
): Promise<CommandResult> => {
  const root = projectRoot(ctx);
  const loaded = loadRegistry(ctx.runtime, root);
  if (loaded.kind === "absent")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "contract.error.no_registry", usage, { file: CONTRACT_FILE }),
    );
  if (loaded.kind === "invalid")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "contract.error.invalid", usage, { issues: loaded.issues.join("; ") }),
    );
  const config = liveConfig(loadProjectConfig(ctx.runtime, root));
  if (config === undefined)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "contract.live.not_configured", LIVE_CONFIG_HINT));
  const source = ctx.runtime.readText(toAbsolutePath(join(root, CONTRACT_FILE)));
  const shape = parseShape(source.ok ? source.value : "");
  const contractOnly = consistencyProblems(loaded.registry, shape).length;
  const outcome = await withApp(config, root, () => runLive(loaded.registry, config.base, sendFor(config.port)));
  if ("failed" in outcome)
    return success({ schema, ran: false, app: outcome.failed, live: [], calls: [], contractProblems: contractOnly }, [
      ctx.t("contract.live.app_failed", { state: outcome.failed, port: config.port }),
    ]);
  const calls = outcome.value.map(({ id, probe, method, path, status }) => ({ id, probe, method, path, status }));
  const live = liveProblems(loaded.registry, shape, outcome.value);
  const data = { schema, ran: true, calls, live, contractProblems: contractOnly };
  const lines = live.map((problem) => ctx.t(`gate.contract.api.${problem.kind}`, { ...problem }));
  if (live.length === 0)
    return success(data, [ctx.t("contract.live.clean", { count: outcome.value.length }), ...lines]);
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human: lines,
    error: { code: "gate_failed", message: lines.join("\n"), fix: "finitemonkey contract run" },
  };
};
