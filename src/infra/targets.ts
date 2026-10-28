import { isDeployContext, WORKFLOW } from "./detect.js";
import {
  type DeployLevel,
  type HostEntry,
  type InfraPattern,
  type InfraTarget,
  PATTERN_GROUP,
  type PatternHit,
  type RiskHit,
  type SourceFile,
  STATIC_PLATFORMS,
  type Tristate,
} from "./types.js";

const MIGRATE =
  /\b(prisma\s+migrate\s+deploy|(?:npm|pnpm|yarn)\s+(?:run\s+)?migrate\S*|alembic\s+upgrade|rails\s+db:migrate|knex\s+migrate|drizzle-kit\s+(?:migrate|push)|manage\.py\s+migrate)/;
const HEALTH = /\bcurl\b[^\n]*(health|status|ready|live)/i;
const IMAGE_PULL = /\bdocker(?:[-\s]compose)?\b[^\n]*\bpull\b|\bdocker\s+push\b|docker\/build-push-action/;

const present = (hits: readonly PatternHit[], pattern: InfraPattern): boolean =>
  hits.some((hit) => hit.pattern === pattern);

const groupPresent = (hits: readonly PatternHit[], group: string): boolean =>
  hits.some((hit) => PATTERN_GROUP[hit.pattern] === group);

const triggerOf = (texts: readonly string[]): string => {
  const workflows = texts.join("\n");
  if (workflows === "") return "manual";
  if (/^\s*workflow_run\s*:/m.test(workflows)) return "workflow_run";
  if (/^\s*tags\s*:/m.test(workflows) || /^\s*release\s*:/m.test(workflows)) return "tag";
  if (/^\s*push\s*:|^on:\s*\[?[^\n]*\bpush\b/m.test(workflows)) return "push";
  return workflows.includes("workflow_dispatch") ? "manual" : "unknown";
};

const firstMatch = (texts: readonly string[], pattern: RegExp): string | undefined =>
  texts.map((text) => pattern.exec(text)?.[1]).find((found) => found !== undefined);

const sshTarget = (
  files: readonly SourceFile[],
  hits: readonly PatternHit[],
  risks: readonly RiskHit[],
  hosts: readonly HostEntry[],
): InfraTarget => {
  const deploy = files.filter((file) => isDeployContext(file, hits));
  const texts = deploy.map((file) => file.text);
  const workflows = deploy.filter((file) => WORKFLOW.test(file.path)).map((file) => file.text);
  const has = (id: string): boolean => risks.some((risk) => risk.id === id);
  const image = texts.some((text) => IMAGE_PULL.test(text));
  return {
    type: "ssh",
    trigger: triggerOf(workflows),
    buildLocation: has("build-on-server") ? "server" : image ? "ci" : "unknown",
    artifact: has("git-pull-on-server") ? "source" : image ? "image" : "files",
    migration: firstMatch(texts, MIGRATE) ?? "none",
    health: texts.some((text) => HEALTH.test(text)) ? "yes" : "no",
    rollback: texts.some((text) => /rollback|previous/i.test(text)) ? "scripted" : "none",
    waitsForCi: workflows.length === 0 ? "no" : has("deploy-without-ci") ? "no" : "yes",
    hosts: hosts.map((entry) => entry.alias),
  };
};

const platformTarget = (pattern: InfraPattern): InfraTarget => ({
  type: `platform:${pattern}`,
  trigger: "platform",
  buildLocation: "platform",
  artifact: STATIC_PLATFORMS.has(pattern) ? "static" : "platform",
  migration: "none",
  health: "unknown",
  rollback: "platform",
  waitsForCi: "unknown" satisfies Tristate,
  hosts: [],
});

const kubeTarget = (files: readonly SourceFile[]): InfraTarget => {
  const workflows = files.filter((file) => WORKFLOW.test(file.path) && /\b(kubectl|helm)\b/.test(file.text));
  return {
    type: "kubernetes",
    trigger: triggerOf(workflows.map((file) => file.text)),
    buildLocation: "ci",
    artifact: "image",
    migration:
      firstMatch(
        files.map((file) => file.text),
        MIGRATE,
      ) ?? "none",
    health: files.some((file) => /readinessProbe|livenessProbe/.test(file.text)) ? "yes" : "no",
    rollback: "kubernetes",
    waitsForCi: workflows.some((file) => /^\s*needs\s*:/m.test(file.text)) ? "yes" : "unknown",
    hosts: [],
  };
};

export const buildTargets = (
  files: readonly SourceFile[],
  hits: readonly PatternHit[],
  risks: readonly RiskHit[],
  hosts: readonly HostEntry[],
): readonly InfraTarget[] => {
  const platforms = [...new Set(hits.map((hit) => hit.pattern))].filter((id) => PATTERN_GROUP[id] === "platform");
  return [
    ...platforms.map(platformTarget),
    ...(groupPresent(hits, "ssh") || groupPresent(hits, "script") ? [sshTarget(files, hits, risks, hosts)] : []),
    ...(groupPresent(hits, "kubernetes") ? [kubeTarget(files)] : []),
  ];
};

export const detectLevel = (hits: readonly PatternHit[], hosts: readonly HostEntry[]): DeployLevel => {
  if (groupPresent(hits, "kubernetes")) return 3;
  if (groupPresent(hits, "iac") || hosts.length > 1) return 2;
  const server = ["container", "server", "ssh", "script"].some((group) => groupPresent(hits, group));
  const dynamicPlatform = hits.some(
    (hit) => PATTERN_GROUP[hit.pattern] === "platform" && !STATIC_PLATFORMS.has(hit.pattern),
  );
  return server || dynamicPlatform || present(hits, "migrations") ? 1 : 0;
};

export const findConflicts = (targets: readonly InfraTarget[]): readonly string[] => {
  const types = targets.map((target) => target.type);
  return types.length > 1 ? [types.join(" + ")] : [];
};
