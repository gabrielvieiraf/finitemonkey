import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import {
  LIVE_PROBES,
  LIVE_PROVIDERS,
  liveOutcome,
  type LiveProvider,
  liveProvider,
  liveRequest,
} from "../secrets/live.js";
import { isPerson } from "../secrets/project.js";
import type { CommandSpec } from "./types.js";

export const SECRETS_LIVE_SCHEMA = "finitemonkey/secrets-live@1";

const USAGE = `finitemonkey secrets live <${LIVE_PROVIDERS.join("|")}> --env <VARIABLE> [--send]`;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const target = (provider: LiveProvider): { readonly host: string; readonly url: string } => {
  const probe = LIVE_PROBES[provider];
  return { host: probe.host, url: `https://${probe.host}${probe.path}` };
};

const dryRun = (ctx: Ctx, provider: LiveProvider, variable: string): CommandResult => {
  const { host, url } = target(provider);
  const data = { schema: SECRETS_LIVE_SCHEMA, provider, host, url, variable, sent: false };
  return success(data, [ctx.t("secrets.live.dry", { host, url, variable, provider })]);
};

const send = (ctx: Ctx, provider: LiveProvider, variable: string, key: string): CommandResult => {
  const { host, url } = target(provider);
  ctx.io.stderr.write(`${ctx.t("secrets.live.contacting", { host, url })}\n`);
  const outcome = liveOutcome(ctx.runtime.exec(liveRequest(provider, key, ctx.cwd)));
  const data = { schema: SECRETS_LIVE_SCHEMA, provider, host, url, variable, sent: true, ...outcome };
  const line = ctx.t(`secrets.live.${outcome.verdict}`, { host, status: outcome.status ?? 0, variable });
  if (outcome.verdict !== "unreachable") return success(data, [line]);
  return failureFrom(ctx.t, {
    code: "secrets_live_unreachable",
    messageKey: "secrets.live.unreachable",
    params: { host, status: 0, variable },
    fix: "install curl or check the network, then run the command again",
    exitCode: ExitCode.CheckFailed,
    data,
  });
};

export const secretsLiveCommand: CommandSpec = {
  path: ["secrets", "live"],
  summaryKey: "secrets.command.live",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { env: { type: "string" }, send: { type: "boolean" } },
  run: (ctx, args) => {
    const provider = liveProvider(args.positionals[0]);
    const variable = stringOption(args.values, "env") ?? "";
    if (provider === undefined || !ENV_NAME.test(variable))
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, {
            detail: provider === undefined ? (args.positionals[0] ?? "<provider>") : "--env <VARIABLE>",
          }),
        ),
      );
    if (args.values["send"] !== true) return Promise.resolve(dryRun(ctx, provider, variable));
    if (!isPerson(ctx))
      return Promise.resolve(
        failureFrom(
          ctx.t,
          needsPersonProblem("secrets.error.person_only", `${USAGE.replace(" [--send]", "")} --send`, {
            action: ctx.t("secrets.action.live"),
          }),
        ),
      );
    const key = ctx.env[variable] ?? "";
    if (key === "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "secrets.live.no_value", USAGE, { variable })),
      );
    return Promise.resolve(send(ctx, provider, variable, key));
  },
};
