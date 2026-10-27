export const FOOTPRINT_KINDS = ["reads", "writes", "sends"] as const;

export type FootprintKind = (typeof FOOTPRINT_KINDS)[number];

export interface FootprintEntry {
  readonly id: string;
  readonly kind: FootprintKind;
  readonly targets: readonly string[];
  readonly via?: string;
}

export const FOOTPRINT = [
  { id: "hook-input", kind: "reads", targets: ["stdin"] },
  {
    id: "claude-settings",
    kind: "reads",
    targets: [".claude/settings.json", ".claude/settings.local.json", "~/.claude/settings.json"],
  },
  {
    id: "instructions",
    kind: "reads",
    targets: ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude/rules/", ".claudeignore"],
  },
  { id: "session-logs", kind: "reads", targets: ["~/.claude/projects/"] },
  { id: "git", kind: "reads", targets: [".git/"], via: "git" },
  { id: "changed-files", kind: "reads", targets: ["git diff"], via: "git" },
  {
    id: "config",
    kind: "reads",
    targets: [
      ".finitemonkey/config.yml",
      ".finitemonkey/policy.yml",
      ".finitemonkey/briefing.md",
      ".finitemonkey/look.yml",
    ],
  },
  {
    id: "install",
    kind: "writes",
    targets: [
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".claude/skills/verify/SKILL.md",
      "AGENTS.md",
      "CLAUDE.md",
      ".gitignore",
      ".finitemonkey/config.yml",
      ".finitemonkey/lock.json",
      ".finitemonkey/locks/",
      ".finitemonkey/runtime/",
      ".finitemonkey/backups/",
    ],
  },
  { id: "tasks", kind: "writes", targets: [".finitemonkey/tasks/", ".finitemonkey/state.json"] },
  {
    id: "evidence",
    kind: "writes",
    targets: [".finitemonkey/evidence/", ".finitemonkey/log.jsonl", ".finitemonkey/prod-evidence.jsonl"],
  },
  {
    id: "person",
    kind: "writes",
    targets: [".finitemonkey/trust.json", ".finitemonkey/allow/", ".finitemonkey/cache/"],
  },
  {
    id: "secrets",
    kind: "writes",
    targets: [".finitemonkey/findings/baseline.json", ".finitemonkey/incidents/"],
  },
  {
    id: "git-safety",
    kind: "writes",
    targets: [
      ".finitemonkey/git/",
      ".finitemonkey/git-journal.jsonl",
      ".finitemonkey/merge-dropped.json",
      "refs/finitemonkey/backup/",
    ],
  },
  { id: "reports", kind: "writes", targets: [".finitemonkey/reports/"] },
  { id: "look", kind: "writes", targets: [".finitemonkey/look/"] },
  { id: "review", kind: "writes", targets: [".finitemonkey/review/", ".claude/agents/verifier.md"] },
  { id: "github", kind: "sends", targets: ["api.github.com"], via: "gh" },
  { id: "local-app", kind: "sends", targets: ["127.0.0.1"], via: "app check" },
  { id: "deps-registry", kind: "sends", targets: ["registry.npmjs.org", "pypi.org"], via: "curl" },
  {
    id: "secrets-live",
    kind: "sends",
    targets: [
      "api.github.com",
      "api.stripe.com",
      "api.openai.com",
      "api.anthropic.com",
      "api.digitalocean.com",
      "api.cloudflare.com",
      "api.asaas.com",
    ],
    via: "curl",
  },
] as const satisfies readonly FootprintEntry[];

export type FootprintId = (typeof FOOTPRINT)[number]["id"];

export const SENDS_HOSTS: readonly string[] = FOOTPRINT.filter((entry) => entry.kind === "sends").flatMap(
  (entry) => entry.targets,
);
