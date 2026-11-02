import { modelReason } from "../hooks/reason.js";
import type { Translate } from "../i18n/translate.js";
import type { ModRule, TightenMode } from "../mod/state.js";

export const MOD_GIT_GUARD = "mod-git";

const GIT = String.raw`(?:^|[\s;&|(])git\b[^;&|]*\s`;
const FORCE_PUSH = String.raw`${GIT}push\b[^;&|]*\s(?:--force(?![-\w])|-[A-Za-z]*f[A-Za-z]*(?![-\w])|\+[^\s;&|]+)`;
const RESET_HARD = String.raw`${GIT}reset\b[^;&|]*\s--hard\b`;
const CLEAN_FORCE = String.raw`${GIT}clean\b[^;&|]*\s(?:-[A-Za-z]*f|--force\b)`;
const DELETE = String.raw`(?:--delete|-d)\b`;
const FORCE = String.raw`(?:--force|-f)\b`;
const BRANCH_FORCE_DELETE = String.raw`${GIT}branch\b[^;&|]*\s(?:-[A-Za-z]*D|${DELETE}[^;&|]*\s${FORCE}|${FORCE}[^;&|]*\s${DELETE})`;

export const gitDamageRules = (t: Translate, mode: TightenMode): readonly ModRule[] =>
  mode === "off"
    ? []
    : [
        {
          id: "git.force_push",
          target: "command",
          pattern: FORCE_PUSH,
          reason: modelReason(t, "git.block.force_push", { command: "git push --force" }),
          mode,
        },
        {
          id: "git.reset_hard",
          target: "command",
          pattern: RESET_HARD,
          reason: modelReason(t, "git.block.reset_hard", { command: "git reset --hard" }),
          mode,
        },
        {
          id: "git.clean",
          target: "command",
          pattern: CLEAN_FORCE,
          reason: modelReason(t, "git.block.clean", { command: "git clean -f" }),
          mode,
        },
        {
          id: "git.branch_force_delete",
          target: "command",
          pattern: BRANCH_FORCE_DELETE,
          reason: modelReason(t, "git.block.branch_force_delete", { command: "git branch -D" }),
          mode,
        },
      ];
