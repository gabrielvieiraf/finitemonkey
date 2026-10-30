import { projectPaths } from "../gate/hooks/common.js";
import { deny } from "../guards/context.js";
import type { HookDecision, HookHandler, HookHandlers } from "../hooks/handlers.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { readState } from "../task/state.js";
import { type Assumption, openHighImpact, refreshTriggers } from "./assumptions.js";
import { irreversibleStep } from "./irreversible.js";
import { onceFor } from "./once.js";
import { taskList } from "./tasks.js";

const allow: HookDecision = { kind: "allow" };

export const assumptionLine = (item: Assumption): string =>
  `- ${item.id}: ${item.text}${item.verify === "" ? "" : ` (verify: ${item.verify})`}`;

export const assumptionHold: HookHandler = (input) => {
  const paths = projectPaths(input);
  const task = paths === undefined ? undefined : readState(input.runtime, paths).active;
  if (paths === undefined || task === undefined) return allow;
  const step = irreversibleStep(input.payload.raw, paths.root);
  if (step === undefined) return allow;
  const text = input.runtime.readText(paths.task(task));
  const ids = text.ok ? taskList(text.value, "assumptions") : [];
  if (ids.length === 0) return allow;
  const open = openHighImpact(refreshTriggers(input.runtime, paths), ids);
  if (open.length === 0) return allow;
  const signature = sha256Hex(`${task}\u0000${step.kind}\u0000${step.target}`);
  if (!onceFor(input.runtime, paths, "assumption-holds.json", signature)) return allow;
  const list = open.map(assumptionLine).join("\n");
  return deny(
    input.t("guardian.assumptions.reason", { kind: step.kind, target: step.target, list }),
    input.t("guardian.assumptions.human", { count: open.length, kind: step.kind }),
  );
};

export const ASSUMPTION_HANDLERS: HookHandlers = { PreToolUse: [assumptionHold] };
