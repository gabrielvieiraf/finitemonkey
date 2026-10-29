import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { onceFor } from "../guardian/once.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile } from "../task/state.js";
import type { DriftWarning } from "./sensor.js";
import { DRIFT_CACHE, warningsOf } from "./store.js";

export const DRIFT_FEATURE = "drift-sensor";
const REFRESH_MS = 86_400_000;

const allow: HookDecision = { kind: "allow" };

const usable = (input: HookInput): FmPaths | undefined => {
  const paths = projectPaths(input);
  return paths !== undefined && input.runtime.stat(paths.dir)?.kind === "dir" ? paths : undefined;
};

export const warningLine = (t: Translate, warning: DriftWarning): string =>
  t("drift.warning", {
    indicator: t(`drift.indicator.${warning.indicator}`),
    taskClass: warning.taskClass,
    since: warning.since,
    baseline: warning.baseline,
    current: warning.current,
    changes: warning.changes.length === 0 ? t("drift.no_change") : warning.changes.join(", "),
  });

export const driftRefresh: HookHandler = (input) => {
  const paths = usable(input);
  if (paths === undefined || input.payload.stopHookActive) return allow;
  const at = readJsonFile(input.runtime, paths.cache(DRIFT_CACHE))?.["at"];
  const stale = typeof at !== "string" || Date.parse(input.runtime.now()) - Date.parse(at) > REFRESH_MS;
  if (stale) input.runtime.spawnSelf(["drift", "--refresh"], paths.root);
  return allow;
};

export const driftSession: HookHandler = (input) => {
  const paths = usable(input);
  if (paths === undefined) return allow;
  const fresh = warningsOf(input.runtime, paths).filter((warning) =>
    onceFor(input.runtime, paths, "drift-shown.json", `${warning.indicator}|${warning.taskClass}|${warning.since}`),
  );
  if (fresh.length === 0) return allow;
  if (featureMode(input.runtime, paths, DRIFT_FEATURE) !== "active") {
    recordFeatureShadow(input.runtime, paths, DRIFT_FEATURE, { warnings: fresh.length });
    return allow;
  }
  const text = fresh.map((warning) => warningLine(input.t, warning)).join("\n");
  return { kind: "allow", output: contextOutput("SessionStart", text, text) };
};

export const DRIFT_HANDLERS: HookHandlers = { Stop: [driftRefresh], SessionStart: [driftSession] };
