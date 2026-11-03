import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import {
  AWS_PROVIDER,
  AWS_SECRET_ENV,
  AWS_STS,
  AWS_TOKEN_ENV,
  AWS_URL,
  type AwsCredentials,
  awsLiveRequest,
  awsSentHeaders,
} from "../secrets/aws-live.js";
import { liveOutcome } from "../secrets/live.js";
import type { OptionValues } from "./types.js";

export const SECRETS_LIVE_SCHEMA = "finitemonkey/secrets-live@1";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface AwsTarget {
  readonly variable: string;
  readonly secretVariable: string;
  readonly withToken: boolean;
}

const awsData = (target: AwsTarget, sent: boolean) => ({
  schema: SECRETS_LIVE_SCHEMA,
  provider: AWS_PROVIDER,
  host: AWS_STS.host,
  url: AWS_URL,
  variable: target.variable,
  secretVariable: target.secretVariable,
  sent,
  sends: awsSentHeaders(target.withToken),
});

const sendsLine = (ctx: Ctx, target: AwsTarget): string =>
  ctx.t("secrets.live.sends_aws", {
    url: AWS_URL,
    headers: awsSentHeaders(target.withToken).join(", "),
    secret: target.secretVariable,
  });

export const awsTarget = (ctx: Ctx, values: OptionValues, variable: string): AwsTarget | undefined => {
  const secretVariable = stringOption(values, "secret-env") ?? AWS_SECRET_ENV;
  if (!ENV_NAME.test(secretVariable)) return undefined;
  return { variable, secretVariable, withToken: (ctx.env[AWS_TOKEN_ENV] ?? "") !== "" };
};

export const awsDryRun = (ctx: Ctx, target: AwsTarget): CommandResult =>
  success(awsData(target, false), [
    ctx.t("secrets.live.dry", { host: AWS_STS.host, url: AWS_URL, variable: target.variable, provider: AWS_PROVIDER }),
    sendsLine(ctx, target),
  ]);

const credentialsOf = (ctx: Ctx, target: AwsTarget): AwsCredentials | string => {
  const accessKey = ctx.env[target.variable] ?? "";
  if (accessKey === "") return target.variable;
  const secretKey = ctx.env[target.secretVariable] ?? "";
  if (secretKey === "") return target.secretVariable;
  const token = ctx.env[AWS_TOKEN_ENV] ?? "";
  return token === "" ? { accessKey, secretKey } : { accessKey, secretKey, sessionToken: token };
};

export const awsSend = (ctx: Ctx, target: AwsTarget, usage: string): CommandResult => {
  const credentials = credentialsOf(ctx, target);
  if (typeof credentials === "string")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "secrets.live.no_value", usage, { variable: credentials }),
    );
  const host = AWS_STS.host;
  ctx.io.stderr.write(`${ctx.t("secrets.live.contacting", { host, url: AWS_URL })}\n`);
  ctx.io.stderr.write(`${sendsLine(ctx, target)}\n`);
  const outcome = liveOutcome(ctx.runtime.exec(awsLiveRequest(credentials, ctx.runtime.now(), ctx.cwd)));
  const data = { ...awsData(target, true), ...outcome };
  const line = ctx.t(`secrets.live.${outcome.verdict}`, {
    host,
    status: outcome.status ?? 0,
    variable: target.variable,
  });
  if (outcome.verdict !== "unreachable") return success(data, [line]);
  return failureFrom(ctx.t, {
    code: "secrets_live_unreachable",
    messageKey: "secrets.live.unreachable",
    params: { host, status: 0, variable: target.variable },
    fix: "install curl or check the network, then run the command again",
    exitCode: ExitCode.CheckFailed,
    data,
  });
};
