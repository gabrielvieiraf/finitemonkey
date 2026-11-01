import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { parseContract, taskRelative } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import type { TaskSize } from "../task/types.js";
import { UI_CONTRACT_FEATURE } from "./contract.js";
import { capUiContract } from "./contract-budget.js";

export interface BudgetedProposal {
  readonly source: string;
  readonly dropped: readonly string[];
  readonly applied: boolean;
  readonly size: TaskSize | undefined;
}

export const taskSizeOf = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): TaskSize | undefined => {
  const text = runtime.readText(toAbsolutePath(join(paths.root, taskRelative(task))));
  const parsed = text.ok ? parseContract(task, text.value) : undefined;
  return parsed?.ok === true ? parsed.value.size : undefined;
};

export const budgetProposal = (
  runtime: Pick<Runtime, "readText" | "homeDir" | "appendText" | "now">,
  paths: FmPaths,
  task: string,
  source: string,
): BudgetedProposal => {
  const size = taskSizeOf(runtime, paths, task);
  const mode = featureMode(runtime, paths, UI_CONTRACT_FEATURE);
  const parsed = parseYaml(source);
  if (size === undefined || mode === "off" || !parsed.ok) return { source, dropped: [], applied: false, size };
  const capped = capUiContract(parsed.value, size);
  if (capped.dropped.length === 0) return { source, dropped: [], applied: false, size };
  if (mode === "shadow") {
    recordFeatureShadow(runtime, paths, UI_CONTRACT_FEATURE, { task, size, dropped: capped.dropped.length });
    return { source, dropped: capped.dropped, applied: false, size };
  }
  return { source: stringifyYaml(capped.tree), dropped: capped.dropped, applied: true, size };
};
