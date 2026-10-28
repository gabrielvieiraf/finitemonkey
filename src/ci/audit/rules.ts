import type { ProjectLevel } from "../level.js";
import type { Permissions, Workflow, WorkflowJob, WorkflowStep } from "./workflow.js";

export const AUDIT_RULES = [
  "dangerous-trigger",
  "template-injection",
  "persisted-credentials",
  "permissions",
  "unpinned-action",
  "secret-printed",
  "deploy-unsafe",
  "self-hosted-public",
  "no-timeout",
] as const;

export type AuditRule = (typeof AUDIT_RULES)[number];

export type Severity = "block" | "warn";

export interface AuditHit {
  readonly rule: string;
  readonly severity: Severity;
  readonly job: string;
  readonly detail: string;
  readonly needle: string;
}

export interface AuditContext {
  readonly level: ProjectLevel;
  readonly publicRepo: boolean;
}

const ALWAYS_BLOCK: ReadonlySet<AuditRule> = new Set([
  "dangerous-trigger",
  "template-injection",
  "persisted-credentials",
  "secret-printed",
  "self-hosted-public",
]);
const BLOCK_FROM_LEVEL_2: ReadonlySet<AuditRule> = new Set(["permissions", "unpinned-action", "deploy-unsafe"]);

export const severityOf = (rule: AuditRule, level: ProjectLevel): Severity =>
  ALWAYS_BLOCK.has(rule) || (BLOCK_FROM_LEVEL_2.has(rule) && level >= 2) ? "block" : "warn";

type Found = Omit<AuditHit, "severity"> & { readonly rule: AuditRule };

const PR_CODE_REF = /github\.event\.pull_request\.head|github\.head_ref|workflow_run\.head_(?:sha|branch)|refs\/pull\//;
const PR_CODE_RUN = /\bgh pr checkout\b|git fetch\b[^\n]*\bpull\//;
const EXPRESSION = /\$\{\{([^}]*)\}\}/g;
const UNTRUSTED = /github\.event\.|github\.head_ref|client_payload/;
const SAFE_FIELD = /\.(?:number|id|sha|head_sha|base_sha|conclusion|run_id|run_number|merged|draft)\s*$/;
const INSTALL =
  /\b(?:npm (?:ci|install|i)\b|pnpm (?:install|i)\b|yarn(?: install)?\s*(?:$|--|&|;)|bun (?:install|i)\b|pip3? install|uv sync|poetry install|bundle install|composer install)/m;
const PRINT = /\b(?:echo|printf|tee)\b[^\n]*\$\{\{\s*secrets\./;
const SHA = /^[0-9a-f]{40}$/;
const DEPLOY = /deploy|production/i;

const isCheckout = (step: WorkflowStep): boolean => step.uses?.startsWith("actions/checkout@") === true;

const firstLine = (text: string): string => text.trim().split("\n")[0]?.trim() ?? "";

const dangerousTrigger = (workflow: Workflow, job: WorkflowJob): readonly Found[] => {
  const target = workflow.triggers.includes("pull_request_target");
  const run = workflow.triggers.includes("workflow_run");
  if (!target && !run) return [];
  if (!target && /workflow_run\.event\s*==\s*'push'/.test(job.if)) return [];
  return job.steps.flatMap((step): Found[] => {
    const ref = isCheckout(step) ? (step.with["ref"] ?? "") : "";
    const script = step.run ?? "";
    const fetches = PR_CODE_RUN.test(script);
    if (!PR_CODE_REF.test(ref) && !fetches) return [];
    const trigger = target ? "pull_request_target" : "workflow_run";
    const needle = fetches ? firstLine(script) : ref;
    return [{ rule: "dangerous-trigger", job: job.id, detail: `${trigger} runs pull request code`, needle }];
  });
};

const injectionsIn = (job: WorkflowJob, step: WorkflowStep): readonly Found[] => {
  const scripts = [
    step.run,
    step.uses?.startsWith("actions/github-script@") === true ? step.with["script"] : undefined,
  ];
  return scripts.flatMap((script) =>
    [...(script ?? "").matchAll(EXPRESSION)]
      .map((match) => (match[1] ?? "").trim())
      .filter((expression) => UNTRUSTED.test(expression) && !SAFE_FIELD.test(expression))
      .map((expression) => ({
        rule: "template-injection" as const,
        job: job.id,
        detail: `\${{ ${expression} }} in a script; pass it through env:`,
        needle: expression,
      })),
  );
};

const writes = (permissions: Permissions): boolean =>
  permissions === "missing" ||
  permissions === "write-all" ||
  (typeof permissions === "object" && Object.values(permissions).includes("write"));

const effective = (workflow: Workflow, job: WorkflowJob): Permissions =>
  job.permissions === "missing" ? workflow.permissions : job.permissions;

const persisted = (workflow: Workflow, job: WorkflowJob): readonly Found[] => {
  if (!writes(effective(workflow, job))) return [];
  const checkout = job.steps.find((step) => isCheckout(step) && step.with["persist-credentials"] !== "false");
  if (checkout === undefined) return [];
  const install = job.steps.find((step) => step.index > checkout.index && INSTALL.test(step.run ?? ""));
  if (install === undefined) return [];
  return [
    {
      rule: "persisted-credentials",
      job: job.id,
      detail: `checkout keeps a write token and "${firstLine(install.run ?? "")}" runs third-party code`,
      needle: checkout.uses ?? "",
    },
  ];
};

const unpinned = (job: WorkflowJob): readonly Found[] =>
  [job.uses, ...job.steps.map((step) => step.uses)].flatMap((uses): Found[] => {
    if (uses === undefined || uses.startsWith("./")) return [];
    const ref = uses.startsWith("docker://") ? (uses.split("@sha256:")[1] ?? "") : (uses.split("@")[1] ?? "");
    const pinnedRef = uses.startsWith("docker://") ? ref.length === 64 : SHA.test(ref);
    return pinnedRef ? [] : [{ rule: "unpinned-action", job: job.id, detail: uses, needle: uses }];
  });

const printed = (job: WorkflowJob): readonly Found[] =>
  job.steps.flatMap((step): Found[] => {
    const run = step.run ?? "";
    const secretEnv = Object.values(step.env).some((value) => value.includes("secrets."));
    const line = run.split("\n").find((text) => PRINT.test(text));
    if (line !== undefined) return [{ rule: "secret-printed", job: job.id, detail: line.trim(), needle: line.trim() }];
    return /\bset -x\b/.test(run) && (secretEnv || run.includes("secrets."))
      ? [{ rule: "secret-printed", job: job.id, detail: "set -x with secrets in the step", needle: "set -x" }]
      : [];
  });

const deployUnsafe = (workflow: Workflow, job: WorkflowJob): readonly Found[] => {
  const deploy =
    DEPLOY.test(job.id) || DEPLOY.test(job.name) || DEPLOY.test(job.environment ?? "") || /deploy/i.test(workflow.file);
  if (!deploy || job.uses !== undefined) return [];
  const missing = [
    ...(job.needs.length > 0 || workflow.triggers.includes("workflow_run") ? [] : ["needs CI"]),
    ...(job.concurrency || workflow.concurrency ? [] : ["concurrency"]),
    ...(job.environment === undefined ? ["environment"] : []),
  ];
  return missing.length === 0
    ? []
    : [{ rule: "deploy-unsafe", job: job.id, detail: `deploy without ${missing.join(", ")}`, needle: `${job.id}:` }];
};

const jobFindings = (workflow: Workflow, job: WorkflowJob, context: AuditContext): readonly Found[] => [
  ...dangerousTrigger(workflow, job),
  ...job.steps.flatMap((step) => injectionsIn(job, step)),
  ...persisted(workflow, job),
  ...(job.permissions === "write-all"
    ? [{ rule: "permissions" as const, job: job.id, detail: "write-all", needle: "write-all" }]
    : []),
  ...unpinned(job),
  ...printed(job),
  ...deployUnsafe(workflow, job),
  ...(context.publicRepo && job.runsOn.includes("self-hosted")
    ? [{ rule: "self-hosted-public" as const, job: job.id, detail: "self-hosted runner", needle: "self-hosted" }]
    : []),
  ...(job.uses === undefined && !job.timeout
    ? [{ rule: "no-timeout" as const, job: job.id, detail: "no timeout-minutes", needle: `${job.id}:` }]
    : []),
];

const topPermissions = (workflow: Workflow): readonly Found[] => {
  if (workflow.permissions === "missing")
    return [{ rule: "permissions", job: "", detail: "no top-level permissions", needle: "jobs:" }];
  return workflow.permissions === "write-all"
    ? [{ rule: "permissions", job: "", detail: "write-all", needle: "write-all" }]
    : [];
};

export const auditWorkflow = (workflow: Workflow, context: AuditContext): readonly AuditHit[] =>
  [...topPermissions(workflow), ...workflow.jobs.flatMap((job) => jobFindings(workflow, job, context))].map(
    (found) => ({ ...found, severity: severityOf(found.rule, context.level) }),
  );
