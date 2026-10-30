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
  { id: "hook-sources", kind: "reads", targets: ["~/.claude/plugins/", "~/.claude/debug/latest"] },
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
      ".finitemonkey/appsec.yml",
      ".finitemonkey/routes-public.yml",
      ".finitemonkey/rules.yml",
      ".finitemonkey/arch.yml",
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
      ".git/finitemonkey/snapshots/",
    ],
  },
  { id: "reports", kind: "writes", targets: [".finitemonkey/reports/"] },
  { id: "pr-scope", kind: "writes", targets: [".finitemonkey/pr/"] },
  { id: "fronts", kind: "writes", targets: [".finitemonkey/fronts.yml", ".finitemonkey/briefing.md"] },
  { id: "profile", kind: "reads", targets: [".finitemonkey/profile.yml", "~/.finitemonkey/profile.yml"] },
  { id: "github-ruleset", kind: "writes", targets: [".finitemonkey/github-ruleset.json"] },
  {
    id: "worktrees",
    kind: "writes",
    targets: [
      ".git/finitemonkey/worktrees.yml",
      ".git/finitemonkey/merges/",
      ".git/info/exclude",
      ".claude/worktrees/",
      "~/.finitemonkey/worktrees/",
      "~/.finitemonkey/archive/",
      "refs/finitemonkey/archive/",
    ],
  },
  { id: "creds", kind: "writes", targets: [".finitemonkey/creds.yml"] },
  {
    id: "supply-chain",
    kind: "writes",
    targets: [".finitemonkey/findings/osv.json", ".github/dependabot.yml", "renovate.json"],
  },
  {
    id: "supervisor",
    kind: "writes",
    targets: ["$FINITEMONKEY_HOLD_DIR/<session>.hold.json"],
  },
  { id: "appsec", kind: "writes", targets: [".finitemonkey/semgrep/", ".finitemonkey/data-map.yml"] },
  {
    id: "rules",
    kind: "writes",
    targets: [".finitemonkey/rules-compiled.json", ".github/workflows/finitemonkey-rules.yml"],
  },
  { id: "look", kind: "writes", targets: [".finitemonkey/look/"] },
  { id: "prompts", kind: "writes", targets: [".finitemonkey/prompts.jsonl"] },
  { id: "spend", kind: "writes", targets: [".finitemonkey/spend.json", ".finitemonkey/spend-reconcile.jsonl"] },
  { id: "plan", kind: "writes", targets: ["docs/plan/"] },
  { id: "map", kind: "writes", targets: [".finitemonkey/map.txt"] },
  {
    id: "signals",
    kind: "writes",
    targets: [".finitemonkey/signals.jsonl", ".finitemonkey/signals-index.json", ".finitemonkey/signals-profile.json"],
  },
  {
    id: "perfil",
    kind: "writes",
    targets: [
      ".finitemonkey/perfil.yml",
      ".finitemonkey/perfil-commits.json",
      ".finitemonkey/conceitos.yml",
      ".finitemonkey/conceitos-events.jsonl",
      ".finitemonkey/xray.json",
      ".finitemonkey/probes.json",
    ],
  },
  { id: "runs", kind: "writes", targets: [".finitemonkey/runs/"] },
  { id: "map", kind: "writes", targets: [".finitemonkey/map.txt", ".finitemonkey/reuse.json"] },
  { id: "review", kind: "writes", targets: [".finitemonkey/review/", ".claude/agents/verifier.md"] },
  { id: "regression", kind: "writes", targets: [".finitemonkey/regression/"] },
  { id: "advisor", kind: "writes", targets: [".finitemonkey/suggestions.jsonl"] },
  { id: "github", kind: "sends", targets: ["api.github.com"], via: "gh" },
  { id: "local-app", kind: "sends", targets: ["127.0.0.1"], via: "app check" },
  { id: "deps-registry", kind: "sends", targets: ["registry.npmjs.org", "pypi.org"], via: "curl" },
  { id: "osv", kind: "sends", targets: ["api.osv.dev"], via: "osv-scanner" },
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
  { id: "deploy", kind: "sends", targets: ["deploy.version_url"], via: "curl" },
  { id: "heavy", kind: "writes", targets: ["~/.finitemonkey/heavy/"] },
  {
    id: "instruction-layers",
    kind: "reads",
    targets: ["~/.claude/CLAUDE.md", "~/.claude/rules/", "/etc/claude-code/CLAUDE.md", "../CLAUDE.md"],
  },
  { id: "instructions-log", kind: "writes", targets: [".finitemonkey/instructions.jsonl"] },
  {
    id: "rules-propose",
    kind: "writes",
    targets: [".finitemonkey/rules.yml", ".finitemonkey/rule-violations.jsonl"],
  },
  { id: "learnings", kind: "writes", targets: [".finitemonkey/learnings.jsonl"] },
  { id: "ownership", kind: "writes", targets: [".finitemonkey/ownership.yml"] },
  { id: "ci-protect", kind: "writes", targets: [".finitemonkey/ci-protect.jsonl"] },
  { id: "ci-watch", kind: "writes", targets: [".finitemonkey/ci-watch/"] },
  { id: "infra", kind: "writes", targets: [".finitemonkey/infra.yml", ".finitemonkey/hosts.local.yml"] },
  { id: "infra-remote", kind: "sends", targets: ["hosts.local.yml"], via: "ssh" },
  {
    id: "observability",
    kind: "writes",
    targets: ["observability/scrub.mjs", "observability/log.mjs", "observability/plan.yml"],
  },
  { id: "headers", kind: "sends", targets: ["headers.url"], via: "curl" },
  { id: "deploy-drift", kind: "sends", targets: ["hosts.local.yml", "FINITEMONKEY_DEPLOY_HOST"], via: "ssh" },
  {
    id: "deploy-generate",
    kind: "writes",
    targets: [".github/workflows/deploy.yml", ".github/workflows/drift.yml", "deploy/remote.sh", "deploy/compose.yml"],
  },
  { id: "golden", kind: "writes", targets: [".finitemonkey/golden/"] },
  { id: "organize", kind: "writes", targets: ["docs/organize/"] },
  {
    id: "api-contract",
    kind: "writes",
    targets: ["src/api/", "src/mocks/", "app/api/", "app/mocks/", "lib/api/", "lib/mocks/"],
  },
  { id: "ds-sync", kind: "writes", targets: [".github/workflows/ds-sync.yml"] },
  {
    id: "python-preset",
    kind: "writes",
    targets: ["ruff.toml", "pytest.ini", "scripts/check_no_comments.py", ".github/workflows/ci.yml"],
  },
  { id: "onboard", kind: "writes", targets: [".finitemonkey/onboard.json", "AGENTS.md"] },
  { id: "ledger-key", kind: "writes", targets: ["~/.finitemonkey/ledger.key"] },
  {
    id: "guardian",
    kind: "writes",
    targets: [
      ".finitemonkey/goals.yml",
      ".finitemonkey/decisions.jsonl",
      ".finitemonkey/assumptions.jsonl",
      ".finitemonkey/research/",
    ],
  },
  { id: "guard-bypass", kind: "writes", targets: [".finitemonkey/bypasses.jsonl"] },
  { id: "mod-cost", kind: "writes", targets: [".finitemonkey/cost.jsonl"] },
  {
    id: "knowledge",
    kind: "writes",
    targets: [
      ".finitemonkey/claims.jsonl",
      ".finitemonkey/derived.json",
      ".finitemonkey/demoted.json",
      ".finitemonkey/retrieve.jsonl",
      ".finitemonkey/decision-records/",
      ".finitemonkey/decision-reasons.jsonl",
      ".finitemonkey/cache/knowledge-map.json",
      ".finitemonkey/cache/questions.json",
    ],
  },
  { id: "infra-plan", kind: "sends", targets: ["terraform provider APIs"], via: "terraform" },
  { id: "parking", kind: "writes", targets: [".finitemonkey/parking.jsonl"] },
  { id: "ui-copy", kind: "writes", targets: [".finitemonkey/cache/copy-rules.json"] },
] as const satisfies readonly FootprintEntry[];

export type FootprintId = (typeof FOOTPRINT)[number]["id"];

export const SENDS_HOSTS: readonly string[] = FOOTPRINT.filter((entry) => entry.kind === "sends").flatMap(
  (entry) => entry.targets,
);
