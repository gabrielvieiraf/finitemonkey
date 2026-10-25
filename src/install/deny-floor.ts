export const DENY_FLOOR = {
  secrets: ["Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", "Read(./**/.env.*)", "Read(./**/*.pem)"],
  git: [
    "Bash(git push --force *)",
    "Bash(git push -f *)",
    "Bash(git clean -f*)",
    "Bash(git reset --hard*)",
    "Bash(git worktree remove --force*)",
  ],
  proof: [
    "Edit(./.finitemonkey/evidence/**)",
    "Edit(./.finitemonkey/runtime/**)",
    "Edit(./.finitemonkey/lock.json)",
    "Edit(./.finitemonkey/log.jsonl)",
    "Edit(./.finitemonkey/state.md)",
    "Edit(./.finitemonkey/state.json)",
    "Edit(./.finitemonkey/trust.json)",
    "Edit(./.finitemonkey/allow/**)",
    "Edit(./.finitemonkey/cache/**)",
  ],
} as const;

export const DENY_RULES: readonly string[] = [...DENY_FLOOR.secrets, ...DENY_FLOOR.git, ...DENY_FLOOR.proof];
