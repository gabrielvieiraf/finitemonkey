import { probeApp } from "../app/node-probe.js";
import {
  type AppProbeRequest,
  type AppProbeResult,
  DEFAULT_APP_TIMEOUT_S,
  DEFAULT_HOST,
  DEFAULT_ROUTE,
  DEFAULT_STATUS,
} from "../app/types.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const APP_CHECK_SCHEMA = "finitemonkey/app-check@1";

export interface AppCheckData extends AppProbeResult {
  readonly schema: typeof APP_CHECK_SCHEMA;
  readonly url: string;
}

const positive = (raw: string | undefined, fallback: number): number | undefined => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

const requestFrom = (ctx: Ctx, values: OptionValues): AppProbeRequest | undefined => {
  const port = positive(stringOption(values, "port"), 0);
  const status = positive(stringOption(values, "status"), DEFAULT_STATUS);
  const timeout = positive(stringOption(values, "timeout"), DEFAULT_APP_TIMEOUT_S);
  if (port === undefined || port === 0 || port > 65535 || status === undefined || timeout === undefined)
    return undefined;
  return {
    host: stringOption(values, "host") ?? DEFAULT_HOST,
    port,
    route: stringOption(values, "route") ?? DEFAULT_ROUTE,
    status,
    body: stringOption(values, "body"),
    start: stringOption(values, "start"),
    cwd: ctx.cwd,
    timeoutMs: timeout * 1000,
  };
};

const humanLine = (ctx: Ctx, data: AppCheckData): string =>
  ctx.t(`app.check.${data.kind}`, {
    url: data.url,
    status: data.status ?? 0,
    code: data.exitCode ?? -1,
  });

const toResult = (ctx: Ctx, request: AppProbeRequest, data: AppCheckData): CommandResult<AppCheckData> => {
  const human = [humanLine(ctx, data)];
  if (data.kind === "ok") return success(data, human);
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human,
    error: {
      code: "app_check_failed",
      message: human.join(" "),
      fix: `finitemonkey app check --port ${String(request.port)}`,
    },
  };
};

export const appCheckCommand: CommandSpec = {
  path: ["app", "check"],
  summaryKey: "command.app_check.summary",
  usage:
    "finitemonkey app check --port <n> [--start <command>] [--route <path>] [--status <code>] [--body <text>] [--timeout <seconds>] [--host <host>]",
  status: "ready",
  options: {
    port: { type: "string" },
    start: { type: "string" },
    route: { type: "string" },
    status: { type: "string" },
    body: { type: "string" },
    timeout: { type: "string" },
    host: { type: "string" },
  },
  run: async (ctx, args) => {
    const request = requestFrom(ctx, args.values);
    if (request === undefined) {
      return {
        ok: false,
        exitCode: ExitCode.Usage,
        human: [ctx.t("app.check.usage")],
        error: {
          code: "app_check_failed",
          message: ctx.t("app.check.usage"),
          fix: "finitemonkey app check --port 3000",
        },
      };
    }
    const result = await probeApp(request);
    const url = `http://${request.host}:${String(request.port)}${request.route}`;
    return toResult(ctx, request, { schema: APP_CHECK_SCHEMA, url, ...result });
  },
};
