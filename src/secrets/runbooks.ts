import { dirname, join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export const RUNBOOK_PROVIDERS = [
  "aws",
  "github",
  "digitalocean",
  "cloudflare",
  "google",
  "mailgun",
  "stripe",
  "database",
  "anthropic",
  "openai",
  "asaas",
  "generic",
] as const;

export type RunbookProvider = (typeof RUNBOOK_PROVIDERS)[number];

const PROVIDER_OF_RULE: Readonly<Record<string, RunbookProvider>> = {
  "aws-access-token": "aws",
  "aws-secret-access-key": "aws",
  "github-pat": "github",
  "github-oauth": "github",
  "github-app-token": "github",
  "github-refresh-token": "github",
  "github-fine-grained-pat": "github",
  "stripe-access-token": "stripe",
  "anthropic-api-key": "anthropic",
  "openai-api-key": "openai",
  "gcp-api-key": "google",
  "asaas-api-key": "asaas",
  "credential-in-url": "database",
  "password-assignment": "database",
  "secret-in-process-args": "database",
};

export const RUNBOOKS_URL = "https://github.com/gabrielvieiraf/finitemonkey/blob/main/runbooks";

export const runbookProvider = (rule: string): RunbookProvider => PROVIDER_OF_RULE[rule] ?? "generic";

export const runbookLink = (runtime: Pick<Runtime, "selfPath" | "stat">, rule: string): string => {
  const file = `${runbookProvider(rule)}.md`;
  const local = toAbsolutePath(join(dirname(dirname(runtime.selfPath)), "runbooks", file));
  return runtime.stat(local)?.kind === "file" ? local : `${RUNBOOKS_URL}/${file}`;
};
