import type { Runtime } from "../core/runtime.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { EVOLVE_FEATURE, readEvolve, writeEvolve } from "../policy/evolved.js";
import { featureMode } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../task/state.js";
import { promotionText } from "./render.js";

const RUN_FILE = "evolve-run.json";
export const EVOLVE_EVERY_MS = 10 * 60_000;

const due = (runtime: Pick<Runtime, "readText" | "writeText" | "now">, paths: FmPaths): boolean => {
  const last = readJsonFile(runtime, paths.cache(RUN_FILE))?.["startedAt"];
  const now = Date.parse(runtime.now());
  if (typeof last === "string" && now - Date.parse(last) < EVOLVE_EVERY_MS) return false;
  writeJsonFile(runtime, paths.cache(RUN_FILE), { startedAt: runtime.now() });
  return true;
};

export const evolveStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || readState(input.runtime, paths).active === undefined) return { kind: "allow" };
  if (featureMode(input.runtime, paths, EVOLVE_FEATURE) === "off" || !due(input.runtime, paths))
    return { kind: "allow" };
  input.runtime.spawnSelf(["policy", "evolve", "--record"], paths.root);
  return { kind: "allow" };
};

export const evolvePrompt: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined) return { kind: "allow" };
  const state = readEvolve(input.runtime, paths.root);
  if (state.unseen.length === 0) return { kind: "allow" };
  writeEvolve(input.runtime, paths.root, { ...state, unseen: [] });
  const lines = state.variants
    .filter((variant) => variant.status === "promoted" && state.unseen.includes(variant.id))
    .map((variant) => promotionText(input.t, variant));
  return lines.length === 0
    ? { kind: "allow" }
    : { kind: "allow", output: contextOutput("UserPromptSubmit", lines.join("\n"), lines.join("\n")) };
};

export const EVOLVE_HANDLERS: HookHandlers = { Stop: [evolveStop], UserPromptSubmit: [evolvePrompt] };
