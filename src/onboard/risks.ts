import type { HistoryEnv } from "../creds/history.js";
import type { Credential } from "../creds/inventory.js";
import type { Ran } from "./run.js";

export const RISK_KINDS = [
  "history_secrets",
  "env_in_history",
  "static_credential",
  "failing_command",
  "worktree",
  "no_lockfile",
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

export interface Risk {
  readonly kind: RiskKind;
  readonly subject: string;
}

export interface RiskInput {
  readonly ran: readonly Ran[];
  readonly historyFindings: number | undefined;
  readonly envHistory: readonly HistoryEnv[];
  readonly credentials: readonly Credential[];
  readonly unregistered: readonly string[];
  readonly lockfileMissing: boolean;
}

const INFRA = [
  /(^|\/)Dockerfile[^/]*$/,
  /(^|\/)(docker-)?compose[^/]*\.ya?ml$/,
  /\.tf$/,
  /(^|\/)(k8s|kubernetes|helm|charts)\//,
  /(^|\/)(fly\.toml|vercel\.json|netlify\.toml|render\.yaml|Procfile|app\.yaml|serverless\.ya?ml)$/,
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
];

export const infraFiles = (files: readonly string[]): readonly string[] =>
  files.filter((file) => INFRA.some((pattern) => pattern.test(file))).sort();

export const activeRisks = (input: RiskInput): readonly Risk[] => [
  ...(input.historyFindings !== undefined && input.historyFindings > 0
    ? [{ kind: "history_secrets" as const, subject: String(input.historyFindings) }]
    : []),
  ...[...new Set(input.envHistory.map((item) => item.file))]
    .sort()
    .map((file) => ({ kind: "env_in_history" as const, subject: file })),
  ...input.credentials
    .filter((item) => item.risk === "high")
    .map((item) => ({ kind: "static_credential" as const, subject: item.name })),
  ...input.ran
    .filter((item) => item.outcome === "failed" || item.outcome === "timeout")
    .map((item) => ({ kind: "failing_command" as const, subject: item.run })),
  ...input.unregistered.map((path) => ({ kind: "worktree" as const, subject: path })),
  ...(input.lockfileMissing ? [{ kind: "no_lockfile" as const, subject: "package.json" }] : []),
];
