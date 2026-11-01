import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { loadProjectConfig } from "../git/project-config.js";
import type { FmPaths } from "../task/paths.js";
import { classShown, showSettings } from "./acceptance.js";
import { rateOf } from "./copy-ledger.js";
import type { Critique } from "./critic.js";
import { readCriticLedger } from "./critic-ledger.js";

export const shownCritiques = (
  runtime: Runtime,
  paths: FmPaths,
  critiques: readonly Critique[],
): readonly Critique[] => {
  const settings = showSettings(loadProjectConfig(runtime, paths.root), "critic");
  const ledger = readCriticLedger(runtime, paths);
  const visible = (heuristic: string): boolean =>
    classShown(rateOf(ledger[heuristic] ?? { shown: {}, accepted: [] }), settings);
  for (const heuristic of new Set(critiques.map((item) => item.heuristic).filter((item) => !visible(item))))
    logEvent(runtime, paths, "ui_critic_hidden", {
      heuristic,
      count: critiques.filter((item) => item.heuristic === heuristic).length,
    });
  return critiques.filter((item) => visible(item.heuristic));
};
