import { DATA_DIR } from "../core/data-dir.js";
export const STATE_DIR = DATA_DIR;
export const SETTINGS_FILE = ".claude/settings.json";
export const GITIGNORE_FILE = ".gitignore";
export const CONFIG_FILE = `${DATA_DIR}/config.yml`;
export const LOCK_FILE = `${DATA_DIR}/lock.json`;
export const BACKUPS_DIR = `${DATA_DIR}/backups`;
export const LOCKS_DIR = `${DATA_DIR}/locks`;
export const INSTALL_LOCK = `${DATA_DIR}/locks/install.lock`;
export const VERIFY_SKILL = ".claude/skills/verify/SKILL.md";
export const LOCAL_BIN = "node_modules/finitemonkey/dist/finitemonkey.mjs";
export const VENDOR_BIN = `${DATA_DIR}/runtime/dist/finitemonkey.mjs`;
export const VENDOR_PACKAGE = `${DATA_DIR}/runtime/package.json`;
export const LOCK_SCHEMA = "finitemonkey/lock@1";
export const PLAN_SCHEMA = "finitemonkey/install-plan@1";
export const GENERATED_MARKER = "finitemonkey:generated v=1";
export const BLOCK_BEGIN = "# finitemonkey:begin v=1";
export const BLOCK_END = "# finitemonkey:end";
export const MD_BLOCK_BEGIN = "<!-- finitemonkey:begin v=1 -->";
export const MD_BLOCK_END = "<!-- finitemonkey:end -->";
export const AGENTS_FILE = "AGENTS.md";
export const CLAUDE_FILE = "CLAUDE.md";
export const AGENTS_IMPORT = "@AGENTS.md";
export const AGENTS_MAX_LINES = 60;
export const INSTALL_LOCK_STALE_MS = 5 * 60 * 1000;

export const COMMITTED_STATE = [
  "config.yml",
  "runtime/",
  "tasks/",
  "rules.yml",
  "policy.yml",
  "findings/",
  "infra.yml",
] as const;
