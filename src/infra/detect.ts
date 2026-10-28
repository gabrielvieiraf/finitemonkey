import type { InfraPattern, PatternHit, SourceFile } from "./types.js";

interface Rule {
  readonly pattern: InfraPattern;
  readonly path: RegExp;
  readonly text?: readonly RegExp[];
}

export const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const YAML = /\.ya?ml$/;
const SHELLISH = /(^|\/)(Makefile|[^/]+\.(sh|bash|ps1))$/;
const COMPOSE = /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
export const SSH_LINE = /appleboy\/ssh-action|\b(?:ssh|scp|rsync)\b[^\n]*?\s["']?[\w.${}-]+@[\w.${}[\]-]+/;

const RULES: readonly Rule[] = [
  { pattern: "vercel", path: /(^|\/)vercel\.json$/ },
  { pattern: "netlify", path: /(^|\/)netlify\.toml$/ },
  { pattern: "fly", path: /(^|\/)fly\.toml$/ },
  { pattern: "render", path: /(^|\/)render\.ya?ml$/ },
  { pattern: "railway", path: /(^|\/)railway\.(json|toml)$/ },
  { pattern: "heroku", path: /(^|\/)Procfile$/ },
  { pattern: "cloudflare", path: /(^|\/)wrangler\.(toml|jsonc?)$/ },
  { pattern: "github-pages", path: WORKFLOW, text: [/actions\/deploy-pages|peaceiris\/actions-gh-pages/] },
  { pattern: "dockerfile", path: /(^|\/)((Dockerfile|Containerfile)(\.[\w-]+)?|[^/]+\.dockerfile)$/ },
  { pattern: "compose", path: COMPOSE },
  { pattern: "terraform", path: /\.tf$/ },
  { pattern: "pulumi", path: /(^|\/)Pulumi\.ya?ml$/ },
  { pattern: "cdk", path: /(^|\/)cdk\.json$/ },
  { pattern: "serverless", path: /(^|\/)serverless\.ya?ml$/ },
  {
    pattern: "kubernetes",
    path: YAML,
    text: [/^kind:\s*(Deployment|StatefulSet|DaemonSet|Ingress|CronJob)\b/m, /^apiVersion:\s*\S/m],
  },
  { pattern: "helm", path: /(^|\/)Chart\.ya?ml$/ },
  { pattern: "kustomize", path: /(^|\/)kustomization\.ya?ml$/ },
  { pattern: "pm2", path: /(^|\/)(ecosystem\.config\.(c?js|json)|pm2\.(json|ya?ml))$/ },
  { pattern: "pm2", path: SHELLISH, text: [/\bpm2\s+(start|restart|reload)\b/] },
  { pattern: "pm2", path: WORKFLOW, text: [/\bpm2\s+(start|restart|reload)\b/] },
  { pattern: "systemd", path: /\.service$/, text: [/^\[Service\]/m] },
  { pattern: "nginx", path: /(^|\/)(nginx[^/]*\.conf|nginx\/.+\.conf|[^/]+\.nginx)$/ },
  { pattern: "caddy", path: /(^|\/)Caddyfile$/ },
  { pattern: "ssh-deploy", path: WORKFLOW, text: [SSH_LINE] },
  { pattern: "ssh-deploy", path: SHELLISH, text: [SSH_LINE] },
  { pattern: "deploy-script", path: /(^|\/)[^/]*deploy[^/]*\.(sh|bash|ps1)$/i },
  { pattern: "deploy-script", path: /(^|\/)Makefile$/, text: [/^deploy\s*:/m] },
  {
    pattern: "migrations",
    path: /(^|\/)(prisma\/migrations|migrations|db\/migrate|alembic\/versions|drizzle)\/.+$|(^|\/)(alembic\.ini|knexfile\.[cm]?[jt]s)$/,
  },
];

const PATH_ONLY: ReadonlySet<InfraPattern> = new Set(["migrations"]);

export const wantsText = (path: string): boolean =>
  RULES.some((rule) => rule.path.test(path) && (rule.text !== undefined || !PATH_ONLY.has(rule.pattern))) ||
  SHELLISH.test(path) ||
  path === "package.json";

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const firstLine = (text: string, patterns: readonly RegExp[] | undefined): number | undefined => {
  if (patterns === undefined) return 1;
  const indexes = patterns.map((pattern) => pattern.exec(text)?.index);
  if (indexes.some((index) => index === undefined)) return undefined;
  return lineOf(text, indexes[0] ?? 0);
};

const isKubeCandidate = (path: string): boolean => !WORKFLOW.test(path) && !COMPOSE.test(path);

const hitFor = (rule: Rule, file: SourceFile): PatternHit | undefined => {
  if (!rule.path.test(file.path)) return undefined;
  if (rule.pattern === "kubernetes" && !isKubeCandidate(file.path)) return undefined;
  const line = firstLine(file.text, rule.text);
  return line === undefined ? undefined : { pattern: rule.pattern, file: file.path, line };
};

export const detectPatterns = (files: readonly SourceFile[], paths: readonly string[]): readonly PatternHit[] => {
  const byText = files.flatMap((file) => RULES.flatMap((rule) => hitFor(rule, file) ?? []));
  const byPath = paths.flatMap((path) =>
    RULES.filter((rule) => PATH_ONLY.has(rule.pattern) && rule.path.test(path)).map((rule): PatternHit => ({
      pattern: rule.pattern,
      file: path,
      line: 1,
    })),
  );
  const seen = new Set<string>();
  return [...byText, ...byPath].filter((hit) => {
    const key = `${hit.pattern}\0${hit.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const isDeployContext = (file: SourceFile, hits: readonly PatternHit[]): boolean =>
  hits.some((hit) => hit.file === file.path && (hit.pattern === "ssh-deploy" || hit.pattern === "deploy-script")) ||
  (WORKFLOW.test(file.path) && /deploy/i.test(file.path));
