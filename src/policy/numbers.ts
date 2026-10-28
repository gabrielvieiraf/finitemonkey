import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, parseConfigYaml } from "../git/project-config.js";
import { policyPath } from "./policy.js";

export const policyNumber = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  path: readonly [string, ...string[]],
  fallback: number,
): number => {
  const text = runtime.readText(policyPath(root));
  if (!text.ok) return fallback;
  const raw = configAt(parseConfigYaml(text.value), ...path);
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
