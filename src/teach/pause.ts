import { dirname } from "node:path";

import { PROBES_FEATURE } from "../conceitos/probes.js";
import { nextProbe } from "../conceitos/probes-run.js";
import { xrayPath } from "../conceitos/xray-run.js";
import { toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { allowWith, human, projectPaths } from "../gate/hooks/common.js";
import { readGateStatus } from "../gate/hooks/status.js";
import type { HookHandler } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { featureMode } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { askQuestion } from "./flow.js";
import { probeLines, questionLines } from "./lines.js";
import { teachOptedIn } from "./opt-in.js";
import { PAUSE_FILE } from "./types.js";

const allow = { kind: "allow" } as const;

export const touchedConcepts = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly string[] => {
  const raw = readJsonFile(runtime, xrayPath(paths));
  const items = Array.isArray(raw?.["items"]) ? raw["items"] : [];
  const found = items.flatMap((item: unknown) => {
    const concepts = isRecord(item) && Array.isArray(item["concepts"]) ? item["concepts"] : [];
    return concepts.flatMap((entry: unknown) =>
      isRecord(entry) && typeof entry["concept"] === "string" ? [entry["concept"]] : [],
    );
  });
  return [...new Set(found)];
};

export const freshPause = (runtime: Runtime, paths: FmPaths): boolean => {
  const status = readGateStatus(runtime, paths);
  if (status?.status !== "passed") return false;
  if (readJsonFile(runtime, paths.cache(PAUSE_FILE))?.["at"] === status.at) return false;
  runtime.mkdir(toAbsolutePath(dirname(paths.cache(PAUSE_FILE))));
  writeJsonFile(runtime, paths.cache(PAUSE_FILE), { at: status.at, task: status.task });
  return true;
};

export const teachPause: HookHandler = (input) => {
  const paths = projectPaths(input);
  const { runtime, t } = input;
  if (paths === undefined || !teachOptedIn(runtime, paths) || !freshPause(runtime, paths)) return allow;
  const session = input.payload.sessionId;
  const asked = askQuestion(
    { runtime, paths },
    { concepts: touchedConcepts(runtime, paths), origin: "edge", ...(session === undefined ? {} : { session }) },
  );
  if (asked.ok) {
    logEvent(runtime, paths, "teach.asked", { question: asked.view.question, origin: "edge" });
    return allowWith({ systemMessage: human(questionLines(t, asked.view).join("\n")) });
  }
  const lines = pauseProbe(runtime, paths, t, session);
  return lines.length === 0 ? allow : allowWith({ systemMessage: human(lines.join("\n")) });
};

export const pauseProbe = (
  runtime: Runtime,
  paths: FmPaths,
  t: Translate,
  session: string | undefined,
): readonly string[] => {
  if (featureMode(runtime, paths, PROBES_FEATURE) === "off") return [];
  const found = nextProbe(runtime, paths, session, nowMs(runtime));
  if (found.probe === undefined) return [];
  logEvent(runtime, paths, "teach.probe_shown", { probe: found.probe.id });
  return probeLines(t, found.probe);
};

export const probeAtClose = (runtime: Runtime, paths: FmPaths, t: Translate): readonly string[] =>
  teachOptedIn(runtime, paths) && freshPause(runtime, paths) ? pauseProbe(runtime, paths, t, undefined) : [];
