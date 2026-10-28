export const INFRA_PATTERNS = [
  "vercel",
  "netlify",
  "fly",
  "render",
  "railway",
  "heroku",
  "cloudflare",
  "github-pages",
  "dockerfile",
  "compose",
  "terraform",
  "pulumi",
  "cdk",
  "serverless",
  "kubernetes",
  "helm",
  "kustomize",
  "pm2",
  "systemd",
  "nginx",
  "caddy",
  "ssh-deploy",
  "deploy-script",
  "migrations",
] as const;

export type InfraPattern = (typeof INFRA_PATTERNS)[number];

export const INFRA_GROUPS = [
  "platform",
  "container",
  "iac",
  "kubernetes",
  "server",
  "ssh",
  "script",
  "migration",
] as const;

export type InfraGroup = (typeof INFRA_GROUPS)[number];

export const PATTERN_GROUP: Readonly<Record<InfraPattern, InfraGroup>> = {
  vercel: "platform",
  netlify: "platform",
  fly: "platform",
  render: "platform",
  railway: "platform",
  heroku: "platform",
  cloudflare: "platform",
  "github-pages": "platform",
  dockerfile: "container",
  compose: "container",
  terraform: "iac",
  pulumi: "iac",
  cdk: "iac",
  serverless: "iac",
  kubernetes: "kubernetes",
  helm: "kubernetes",
  kustomize: "kubernetes",
  pm2: "server",
  systemd: "server",
  nginx: "server",
  caddy: "server",
  "ssh-deploy": "ssh",
  "deploy-script": "script",
  migrations: "migration",
};

export const STATIC_PLATFORMS: ReadonlySet<InfraPattern> = new Set(["vercel", "netlify", "cloudflare", "github-pages"]);

export const INFRA_RISKS = [
  "git-pull-on-server",
  "build-on-server",
  "deploy-without-ci",
  "host-key-unchecked",
  "mutable-image-tag",
  "root-container",
  "host-in-repo",
] as const;

export type InfraRisk = (typeof INFRA_RISKS)[number];

export type RiskSeverity = "high" | "medium" | "low";

export const RISK_SEVERITY: Readonly<Record<InfraRisk, RiskSeverity>> = {
  "git-pull-on-server": "high",
  "build-on-server": "high",
  "deploy-without-ci": "medium",
  "host-key-unchecked": "high",
  "mutable-image-tag": "low",
  "root-container": "medium",
  "host-in-repo": "medium",
};

export const RISK_FIX: Readonly<Record<InfraRisk, string>> = {
  "git-pull-on-server": "build an image in CI and have the server pull it by digest (finitemonkey deploy generate)",
  "build-on-server": "build in CI, not on the production host; the server only pulls and starts the artifact",
  "deploy-without-ci": "make the deploy job depend on the CI job (needs:) or trigger it with workflow_run on success",
  "host-key-unchecked": "pin the host fingerprint in known_hosts instead of StrictHostKeyChecking=no",
  "mutable-image-tag": "pin the image by digest (image@sha256:...) or by an immutable tag",
  "root-container": "add a USER line with a non-root user to the Dockerfile",
  "host-in-repo": "move the address to a secret or variable; the inventory keeps only an alias",
};

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface PatternHit {
  readonly pattern: InfraPattern;
  readonly file: string;
  readonly line: number;
}

export interface RiskHit {
  readonly id: InfraRisk;
  readonly severity: RiskSeverity;
  readonly file: string;
  readonly line: number;
}

export interface HostEntry {
  readonly alias: string;
  readonly host: string;
  readonly user?: string;
  readonly file: string;
  readonly line: number;
}

export type DeployLevel = 0 | 1 | 2 | 3;

export const DEPLOY_LEVELS: readonly DeployLevel[] = [0, 1, 2, 3];

export type Tristate = "yes" | "no" | "unknown";

export interface InfraTarget {
  readonly type: string;
  readonly trigger: string;
  readonly buildLocation: string;
  readonly artifact: string;
  readonly migration: string;
  readonly health: Tristate;
  readonly rollback: string;
  readonly waitsForCi: Tristate;
  readonly hosts: readonly string[];
}

export interface Inventory {
  readonly level: DeployLevel;
  readonly hits: readonly PatternHit[];
  readonly targets: readonly InfraTarget[];
  readonly risks: readonly RiskHit[];
  readonly conflicts: readonly string[];
  readonly hosts: readonly HostEntry[];
}

export const isDeployLevel = (value: unknown): value is DeployLevel =>
  typeof value === "number" && DEPLOY_LEVELS.some((level) => level === value);
