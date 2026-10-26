import type { MessageKey } from "../../i18n/catalogs.js";
import type { Translate } from "../../i18n/translate.js";
import type { GuardOutcome } from "../guard.js";
import type { ForeignFile } from "../ownership.js";
import type { GitBlockRule } from "../verdict.js";

const RULE_KEYS: Readonly<Record<GitBlockRule, MessageKey>> = {
  "force-push": "git.block.force_push",
  "lease-not-own": "git.block.lease_not_own",
  "push-delete": "git.block.push_delete",
  "push-mirror": "git.block.push_mirror",
  clean: "git.block.clean",
  "stash-drop": "git.block.stash_drop",
  "branch-unmerged": "git.block.branch_unmerged",
  "worktree-force": "git.block.worktree_force",
  "rm-worktree": "git.block.rm_worktree",
  "rm-root": "git.block.rm_root",
  "rebase-protected": "git.block.rebase_protected",
  "rebase-shared": "git.block.rebase_shared",
  "merge-side": "git.block.merge_side",
  history: "git.block.history",
  "protected-commit": "git.block.protected_commit",
  "protected-push": "git.block.protected_push",
};

const MAX_FILES = 8;

export const ruleMessage = (t: Translate, rule: GitBlockRule, command: string, subject: string): string =>
  t(RULE_KEYS[rule], { command, subject: subject === "" ? command : subject });

export const fileList = (items: readonly string[]): string => {
  const head = items.slice(0, MAX_FILES).join(", ");
  return items.length > MAX_FILES ? `${head} (+${String(items.length - MAX_FILES)})` : head;
};

const foreignLabel = (t: Translate, file: ForeignFile): string =>
  t(file.reason === "before-session" ? "git.foreign.before" : "git.foreign.other", { path: file.path });

export const outcomeMessage = (t: Translate, outcome: GuardOutcome): string | undefined => {
  switch (outcome.kind) {
    case "block":
      return ruleMessage(t, outcome.rule, outcome.command, outcome.subject);
    case "foreign":
      return t("git.block.foreign", {
        command: outcome.command,
        files: fileList(outcome.files.map((file) => foreignLabel(t, file))),
      });
    case "unknown":
      return t("git.block.unknown", { command: outcome.command });
    case "pass":
    case "snapshot":
      return undefined;
  }
};
