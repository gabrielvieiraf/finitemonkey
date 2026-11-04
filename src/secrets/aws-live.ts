import { createHash, createHmac } from "node:crypto";

import type { ExecRequest } from "../core/runtime.js";
import { LIVE_TIMEOUT_MS } from "./live.js";

export const AWS_PROVIDER = "aws";
export const AWS_STS = {
  host: "sts.amazonaws.com",
  path: "/",
  region: "us-east-1",
  service: "sts",
  body: "Action=GetCallerIdentity&Version=2011-06-15",
  contentType: "application/x-www-form-urlencoded; charset=utf-8",
} as const;
export const AWS_SECRET_ENV = "AWS_SECRET_ACCESS_KEY";
export const AWS_TOKEN_ENV = "AWS_SESSION_TOKEN";

export interface AwsCredentials {
  readonly accessKey: string;
  readonly secretKey: string;
  readonly sessionToken?: string;
}

export interface SignInput {
  readonly method: string;
  readonly host: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly region: string;
  readonly service: string;
  readonly amzDate: string;
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const hmac = (key: string | Buffer, text: string): Buffer => createHmac("sha256", key).update(text, "utf8").digest();

export const amzDateOf = (iso: string): string => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");

export const sigV4Authorization = (
  input: SignInput,
  credentials: Pick<AwsCredentials, "accessKey" | "secretKey">,
): string => {
  const all = { ...input.headers, host: input.host, "x-amz-date": input.amzDate };
  const names = Object.keys(all)
    .map((name) => name.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(all).map(([name, value]) => [name.toLowerCase(), value.trim()]));
  const signed = names.join(";");
  const canonical = [
    input.method,
    input.path,
    input.query,
    ...names.map((name) => `${name}:${lower[name] ?? ""}`),
    "",
    signed,
    sha256(input.body),
  ].join("\n");
  const day = input.amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256(canonical)].join("\n");
  const key = [day, input.region, input.service, "aws4_request"].reduce<string | Buffer>(
    (previous, part) => hmac(previous, part),
    `AWS4${credentials.secretKey}`,
  );
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
};

export const awsHeaders = (credentials: AwsCredentials, now: string): readonly string[] => {
  const amzDate = amzDateOf(now);
  const token = credentials.sessionToken === undefined ? {} : { "x-amz-security-token": credentials.sessionToken };
  const headers = { "content-type": AWS_STS.contentType, ...token };
  const authorization = sigV4Authorization(
    {
      method: "POST",
      host: AWS_STS.host,
      path: AWS_STS.path,
      query: "",
      headers,
      body: AWS_STS.body,
      region: AWS_STS.region,
      service: AWS_STS.service,
      amzDate,
    },
    credentials,
  );
  return [
    `Content-Type: ${AWS_STS.contentType}`,
    `X-Amz-Date: ${amzDate}`,
    ...(credentials.sessionToken === undefined ? [] : [`X-Amz-Security-Token: ${credentials.sessionToken}`]),
    `Authorization: ${authorization}`,
  ];
};

export const AWS_URL = `https://${AWS_STS.host}${AWS_STS.path}`;

export const awsSentHeaders = (withToken: boolean): readonly string[] => [
  "Content-Type",
  "X-Amz-Date",
  ...(withToken ? ["X-Amz-Security-Token"] : []),
  "Authorization",
];

export const awsLiveRequest = (credentials: AwsCredentials, now: string, cwd: ExecRequest["cwd"]): ExecRequest => ({
  command: "curl",
  args: [
    "--silent",
    "--show-error",
    "--proto",
    "=https",
    "--max-time",
    "10",
    "--request",
    "POST",
    "--data-binary",
    AWS_STS.body,
    "--header",
    "@-",
    "--write-out",
    "\n%{http_code}",
    AWS_URL,
  ],
  cwd,
  timeoutMs: LIVE_TIMEOUT_MS,
  input: `${awsHeaders(credentials, now).join("\n")}\n`,
});
