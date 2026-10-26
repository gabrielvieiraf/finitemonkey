import { nowMs } from "../../core/clock.js";
import { isRecord, optionalString, parseJson } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import type { Translate } from "../../i18n/translate.js";
import type { FmPaths } from "../../task/paths.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";
import { ghAuthenticated } from "../pr.js";

export const PRS_CACHE_MS = 10 * 60_000;
export const PRS_TIMEOUT_MS = 3000;
export const PRS_AUTH_TIMEOUT_MS = 2000;

export interface OpenPr {
  readonly number: number;
  readonly state: "conflict" | "behind" | "ok";
}

export const parsePrList = (text: string): readonly OpenPr[] | undefined => {
  const parsed = parseJson(text);
  if (!parsed.ok || !Array.isArray(parsed.value)) return undefined;
  return parsed.value.flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item["number"] !== "number") return [];
    const mergeable = optionalString(item, "mergeable");
    const status = optionalString(item, "mergeStateStatus");
    const state =
      mergeable === "CONFLICTING" || status === "DIRTY" ? "conflict" : status === "BEHIND" ? "behind" : "ok";
    return [{ number: item["number"], state }];
  });
};

export const cachedPrs = (runtime: Runtime, paths: FmPaths): readonly OpenPr[] | undefined => {
  const raw = readJsonFile(runtime, paths.cache("prs.json"));
  const at = raw?.["fetchedAt"];
  const list = raw?.["list"];
  if (typeof at !== "number" || nowMs(runtime) - at > PRS_CACHE_MS) return undefined;
  return parsePrList(JSON.stringify(list ?? []));
};

export const refreshPrs = (runtime: Runtime, paths: FmPaths): readonly OpenPr[] | undefined => {
  if (ghAuthenticated(runtime, paths.root, PRS_AUTH_TIMEOUT_MS) !== "yes") return undefined;
  const result = runtime.exec({
    command: "gh",
    args: [
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "open",
      "--json",
      "number,mergeable,mergeStateStatus",
      "--limit",
      "20",
    ],
    cwd: paths.root,
    timeoutMs: PRS_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) return undefined;
  const list = parsePrList(result.stdout);
  if (list !== undefined)
    writeJsonFile(runtime, paths.cache("prs.json"), {
      fetchedAt: nowMs(runtime),
      list: list.map((pr) => ({
        number: pr.number,
        mergeable: pr.state === "conflict" ? "CONFLICTING" : "MERGEABLE",
        mergeStateStatus: pr.state === "behind" ? "BEHIND" : "CLEAN",
      })),
    });
  return list;
};

export const openPrsLine = (t: Translate, runtime: Runtime, paths: FmPaths): readonly string[] => {
  const list = cachedPrs(runtime, paths);
  if (list === undefined || list.length === 0) return [];
  const items = list.map((pr) => `#${String(pr.number)} ${t(`gate.prs.${pr.state}`)}`).join(", ");
  return [t("gate.prs.line", { count: list.length, items })];
};
