export const STATE_DIR = ".finitemonkey";
export const SETTINGS_FILE = ".claude/settings.json";
export const GITIGNORE_FILE = ".gitignore";
export const CONFIG_FILE = ".finitemonkey/config.yml";
export const LOCK_FILE = ".finitemonkey/lock.json";
export const BACKUPS_DIR = ".finitemonkey/backups";
export const LOCKS_DIR = ".finitemonkey/locks";
export const INSTALL_LOCK = ".finitemonkey/locks/install.lock";
export const VERIFY_SKILL = ".claude/skills/verify/SKILL.md";
export const LOCAL_BIN = "node_modules/finitemonkey/dist/finitemonkey.mjs";
export const VENDOR_BIN = ".finitemonkey/runtime/dist/finitemonkey.mjs";
export const VENDOR_PACKAGE = ".finitemonkey/runtime/package.json";
export const LOCK_SCHEMA = "finitemonkey/lock@1";
export const PLAN_SCHEMA = "finitemonkey/install-plan@1";
export const GENERATED_MARKER = "finitemonkey:generated v=1";
export const BLOCK_BEGIN = "# finitemonkey:begin v=1";
export const BLOCK_END = "# finitemonkey:end";
export const INSTALL_LOCK_STALE_MS = 5 * 60 * 1000;

export const PRESETS = ["neutral", "gabriel"] as const;

export type Preset = (typeof PRESETS)[number];

export const parsePreset = (raw: string | undefined): Preset | undefined =>
  raw === undefined ? "neutral" : PRESETS.find((preset) => preset === raw);

export const COMMITTED_STATE = ["config.yml", "runtime/", "tasks/", "rules.yml", "policy.yml", "findings/"] as const;
