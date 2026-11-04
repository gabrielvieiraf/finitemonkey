import { DATA_DIR_NAMES } from "../core/data-dir.js";

const PROOF_FILES = [
  "evidence/**",
  "runtime/**",
  "lock.json",
  "log.jsonl",
  "state.md",
  "state.json",
  "trust.json",
  "allow/**",
  "cache/**",
] as const;

export const DENY_FLOOR = {
  secrets: ["Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", "Read(./**/.env.*)", "Read(./**/*.pem)"],
  git: [
    "Bash(git push --force *)",
    "Bash(git push -f *)",
    "Bash(git clean -f*)",
    "Bash(git reset --hard*)",
    "Bash(git worktree remove --force*)",
  ],
  proof: DATA_DIR_NAMES.flatMap((dir) => PROOF_FILES.map((file) => `Edit(./${dir}/${file})`)),
} as const;

export const DENY_RULES: readonly string[] = [...DENY_FLOOR.secrets, ...DENY_FLOOR.git, ...DENY_FLOOR.proof];
