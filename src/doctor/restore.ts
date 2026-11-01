import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { isStale, RESTORE_FEATURE, restoreConfig } from "../db/restore.js";
import { lastPassedDrills } from "../db/restore-log.js";
import { CONFIG_FILE, parseConfigYaml } from "../git/project-config.js";
import { featureMode } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { type Check, finding } from "./types.js";

export const checkRestoreDrill: Check = ({ root, runtime }) => {
  const paths = fmPaths(root);
  if (featureMode(runtime, paths, RESTORE_FEATURE) !== "active") return [];
  const text = runtime.readText(toAbsolutePath(join(root, CONFIG_FILE)));
  const config = restoreConfig(parseConfigYaml(text.ok ? text.value : ""));
  const drilled = config.stores.filter((store) => store.restore !== undefined && store.target !== undefined);
  if (drilled.length === 0) return [];
  const last = lastPassedDrills(runtime, paths);
  const stale = drilled.filter((store) => isStale(last[store.name], nowMs(runtime), config.periodDays));
  if (stale.length === 0) return [];
  return [
    finding(
      "restore.drill_stale",
      "warn",
      "doctor.restore.stale",
      { stores: stale.map((store) => store.name).join(", "), days: config.periodDays },
      "doctor.restore.fix_stale",
    ),
  ];
};
