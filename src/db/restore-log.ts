import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";

export const lastPassedDrills = (
  runtime: Pick<Runtime, "readText">,
  paths: Pick<FmPaths, "log">,
): Readonly<Record<string, string>> => {
  const log = runtime.readText(paths.log);
  const last: Record<string, string> = {};
  if (!log.ok) return last;
  for (const line of log.value.split("\n")) {
    if (!line.includes('"restore_drill"')) continue;
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["status"] !== "passed") continue;
    const { store, at } = parsed.value;
    if (typeof store === "string" && typeof at === "string") last[store] = at;
  }
  return last;
};
