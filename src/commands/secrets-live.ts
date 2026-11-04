import { type CommandArgs, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { AWS_PROVIDER } from "../secrets/aws-live.js";
import {
  LIVE_PROBES,
  LIVE_PROVIDERS,
  liveOutcome,
  type LiveProvider,
  liveProvider,
  liveRequest,
  sentHeaders,
} from "../secrets/live.js";
import { isPerson } from "../secrets/project.js";
import { awsDryRun, awsSend, awsTarget, SECRETS_LIVE_SCHEMA } from "./secrets-live-aws.js";
import type { CommandSpec } from "./types.js";

export { SECRETS_LIVE_SCHEMA };

const USAGE = `fm secrets live <${[...LIVE_PROVIDERS, AWS_PROVIDER].join("|")}> --env <VARIABLE> [--secret-env <VARIABLE>] [--send]`;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Target {
  readonly host: string;
  readonly url: string;
  readonly sends: readonly string[];
}

const target = (provider: LiveProvider): Target => {
  const probe = LIVE_PROBES[provider];
  return { host: probe.host, url: `https://${probe.host}${probe.path}`, sends: sentHeaders(provider) };
};

const dryRun = (ctx: Ctx, provider: LiveProvider, variable: string): CommandResult => {
  const { host, url, sends } = target(provider);
  const data = { schema: SECRETS_LIVE_SCHEMA, provider, host, url, variable, sent: false, sends };
  return success(data, [
    ctx.t("secrets.live.dry", { host, url, variable, provider }),
    ctx.t("secrets.live.sends", { url, headers: sends.join(", ") }),
  ]);
};

const sendKey = (ctx: Ctx, provider: LiveProvider, variable: string, key: string): CommandResult => {
  const { host, url, sends } = target(provider);
  ctx.io.stderr.write(`${ctx.t("secrets.live.contacting", { host, url })}\n`);
  ctx.io.stderr.write(`${ctx.t("secrets.live.sends", { url, headers: sends.join(", ") })}\n`);
  const outcome = liveOutcome(ctx.runtime.exec(liveRequest(provider, key, ctx.cwd)));
  const data = { schema: SECRETS_LIVE_SCHEMA, provider, host, url, variable, sent: true, sends, ...outcome };
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

const invalid = (ctx: Ctx, detail: string): CommandResult =>
  failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail }));

const personOnly = (ctx: Ctx): CommandResult =>
  failureFrom(
    ctx.t,
    needsPersonProblem("secrets.error.person_only", `${USAGE.replace(" [--send]", "")} --send`, {
      action: ctx.t("secrets.action.live"),
    }),
  );

const runLive = (ctx: Ctx, args: CommandArgs): CommandResult => {
  const name = args.positionals[0];
  const variable = stringOption(args.values, "env") ?? "";
  const send = args.values["send"] === true;
  if (name === AWS_PROVIDER) {
    const aws = ENV_NAME.test(variable) ? awsTarget(ctx, args.values, variable) : undefined;
    if (aws === undefined) return invalid(ctx, "--env <VARIABLE> --secret-env <VARIABLE>");
    if (!send) return awsDryRun(ctx, aws);
    return isPerson(ctx) ? awsSend(ctx, aws, USAGE) : personOnly(ctx);
  }
  const provider = liveProvider(name);
  if (provider === undefined) return invalid(ctx, name ?? "<provider>");
  if (!ENV_NAME.test(variable)) return invalid(ctx, "--env <VARIABLE>");
  if (!send) return dryRun(ctx, provider, variable);
  if (!isPerson(ctx)) return personOnly(ctx);
  const key = ctx.env[variable] ?? "";
  if (key === "")
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "secrets.live.no_value", USAGE, { variable }));
  return sendKey(ctx, provider, variable, key);
};

export const secretsLiveCommand: CommandSpec = {
  path: ["secrets", "live"],
  summaryKey: "secrets.command.live",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { env: { type: "string" }, "secret-env": { type: "string" }, send: { type: "boolean" } },
  run: (ctx, args) => Promise.resolve(runLive(ctx, args)),
};
