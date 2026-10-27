import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { textField } from "../../hooks/fields.js";
import type { HookHandler } from "../../hooks/handlers.js";
import type { Translate } from "../../i18n/translate.js";
import { loadTask, taskRelative } from "../../task/load.js";
import { readState } from "../../task/state.js";
import type { AcceptanceCheck, TaskContract } from "../../task/types.js";
import { contextOutput, projectPaths } from "./common.js";

export const NO_CONTRACT_AGENTS = /(^|:)(reviewer|verifier|explore|plan|claude-code-guide|statusline-setup)$/i;

const KNOWN_KINDS = new Set([
  "command",
  "tests",
  "diff",
  "placeholders",
  "git",
  "pr",
  "manual",
  "secrets",
  "prose",
  "worktree",
  "merge",
  "review",
  "callers",
  "runtime",
  "look",
  "appsec",
]);

const requirementText = (t: Translate, check: AcceptanceCheck): string => {
  const key = `gate.require.${check.kind}` as const;
  const known = KNOWN_KINDS.has(check.kind);
  return `${check.id} ${t(known ? (key as "gate.require.command") : "gate.require.other", { command: check.run ?? check.kind, kind: check.kind })}`;
};

export const contractFacts = (t: Translate, contract: TaskContract, briefing: boolean): string =>
  [
    t("gate.context.front", { task: contract.id, goal: contract.goal, file: taskRelative(contract.id) }),
    t("gate.context.done_means", { list: contract.acceptance.map((check) => requirementText(t, check)).join("; ") }),
    ...(contract.scope.paths.length > 0 ? [t("gate.context.scope", { paths: contract.scope.paths.join(", ") })] : []),
    ...(briefing ? [t("gate.context.briefing", { file: ".finitemonkey/briefing.md" })] : []),
  ].join("\n");

export const subagentStart: HookHandler = (input) => {
  const agentType = textField(input.payload.raw, "agent_type") ?? "";
  const paths = projectPaths(input);
  if (paths === undefined || NO_CONTRACT_AGENTS.test(agentType)) return { kind: "allow" };
  const { runtime, t } = input;
  const active = readState(runtime, paths).active;
  if (active === undefined) return { kind: "allow" };
  const disk = (relative: string): string | undefined => {
    const text = runtime.readText(toAbsolutePath(join(paths.root, relative)));
    return text.ok ? text.value : undefined;
  };
  const loaded = loadTask(runtime, paths, { disk, base: () => undefined }, active);
  if (!loaded.ok) return { kind: "allow" };
  const briefing = runtime.stat(toAbsolutePath(join(paths.dir, "briefing.md"))) !== undefined;
  return { kind: "allow", output: contextOutput("SubagentStart", contractFacts(t, loaded.value.contract, briefing)) };
};
