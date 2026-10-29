import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson, parseMarkers } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { type Forecast, forecastFor } from "./forecast.js";
import { knownTasks } from "./tasks.js";

export const FORECAST_FEATURE = "forecast";

const hours = (ms: number): string => (ms / 3_600_000).toFixed(1);

export const forecastLine = (t: Translate, forecast: Forecast): string =>
  t("guardian.forecast.line", {
    count: forecast.tasks.length,
    size: forecast.size,
    areas: forecast.areas.join(", "),
    hours: hours(forecast.medianMs),
    runs: forecast.medianGateRuns,
    tasks: forecast.tasks.map((item) => item.id).join(", "),
  });

export const forecastOnTrust: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const paths = projectPaths(input);
  if (paths === undefined || !comesFromPerson(prompt)) return { kind: "allow" };
  const trusted = parseMarkers(prompt).flatMap((marker) => (marker.type === "trust" ? [marker.task] : []));
  if (trusted.length === 0) return { kind: "allow" };
  const tasks = knownTasks(input.runtime, paths);
  const lines = trusted.flatMap((id) => {
    const task = tasks.find((item) => item.contract.id === id);
    const forecast = task === undefined ? undefined : forecastFor(input.runtime, paths, tasks, task.contract);
    return forecast === undefined ? [] : [forecastLine(input.t, forecast)];
  });
  if (lines.length === 0) return { kind: "allow" };
  if (featureMode(input.runtime, paths, FORECAST_FEATURE) !== "active") {
    recordFeatureShadow(input.runtime, paths, FORECAST_FEATURE, { tasks: trusted.join(",") });
    return { kind: "allow" };
  }
  return { kind: "allow", output: contextOutput("UserPromptSubmit", lines.join("\n"), lines.join(" ")) };
};

export const FORECAST_HANDLERS: HookHandlers = { UserPromptSubmit: [forecastOnTrust] };
