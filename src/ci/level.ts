import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, parseConfigYaml } from "../git/project-config.js";
import { type Level, loadPolicy, policyPath } from "../policy/policy.js";

export const PROJECT_LEVELS = [0, 1, 2, 3] as const;

export type ProjectLevel = (typeof PROJECT_LEVELS)[number];

const FROM_POLICY_LEVEL: Readonly<Record<Level, ProjectLevel>> = { light: 0, standard: 1, strict: 2 };

export const projectLevel = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): ProjectLevel => {
  const text = runtime.readText(policyPath(root));
  const raw = text.ok ? configAt(parseConfigYaml(text.value), "projectLevel") : undefined;
  const chosen = PROJECT_LEVELS.find((level) => String(level) === raw);
  return chosen ?? FROM_POLICY_LEVEL[loadPolicy(runtime, root).level];
};
