import type { Runtime } from "../core/runtime.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson, parseMarkers } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../task/state.js";
import type { Decision } from "./decide.js";
import { colorOf, readDecision } from "./refit.js";

export const CALIBRATE_FEATURE = "calibrate";
const RUN_FILE = "calibrate-run.json";
export const REFIT_EVERY_MS = 10 * 60_000;

const due = (runtime: Pick<Runtime, "readText" | "writeText" | "now">, paths: FmPaths): boolean => {
  const last = readJsonFile(runtime, paths.cache(RUN_FILE))?.["startedAt"];
  const now = Date.parse(runtime.now());
  if (typeof last === "string" && now - Date.parse(last) < REFIT_EVERY_MS) return false;
  writeJsonFile(runtime, paths.cache(RUN_FILE), { startedAt: runtime.now() });
  return true;
};

export const calibrateStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || readState(input.runtime, paths).active === undefined) return { kind: "allow" };
  if (featureMode(input.runtime, paths, CALIBRATE_FEATURE) === "off" || !due(input.runtime, paths))
    return { kind: "allow" };
  input.runtime.spawnSelf(["calibrate", "refit"], paths.root);
  return { kind: "allow" };
};

const STATE_KEYS = {
  run: "calibrate.state.run",
  ask: "calibrate.state.ask",
  abstain: "calibrate.state.abstain",
} as const;

export const stateLine = (t: Translate, task: string, decision: Decision): string =>
  t(STATE_KEYS[decision.state], {
    task,
    color: colorOf(decision),
    by: decision.by,
  });

export const calibrateOnTrust: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const paths = projectPaths(input);
  if (paths === undefined || !comesFromPerson(prompt)) return { kind: "allow" };
  const trusted = parseMarkers(prompt).flatMap((marker) => (marker.type === "trust" ? [marker.task] : []));
  const lines = trusted.flatMap((task) => {
    const decision = readDecision(input.runtime, paths, task);
    return decision === undefined ? [] : [stateLine(input.t, task, decision)];
  });
  if (lines.length === 0) return { kind: "allow" };
  if (featureMode(input.runtime, paths, CALIBRATE_FEATURE) !== "active") {
    recordFeatureShadow(input.runtime, paths, CALIBRATE_FEATURE, { tasks: trusted.join(",") });
    return { kind: "allow" };
  }
  return { kind: "allow", output: contextOutput("UserPromptSubmit", lines.join("\n"), lines.join(" ")) };
};

export const CALIBRATE_HANDLERS: HookHandlers = { Stop: [calibrateStop], UserPromptSubmit: [calibrateOnTrust] };
