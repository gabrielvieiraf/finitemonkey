import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { amendmentsPath } from "../task/amend.js";
import type { FmPaths } from "../task/paths.js";
import { type Criterion, domainOfText, HORIZON_EVENT, recordHorizon } from "./blind-band.js";

export interface ScopeAddition {
  readonly task: string;
  readonly files: readonly string[];
  readonly approvedAt: string;
}

type Store = Pick<Runtime, "readText" | "appendText" | "now">;

const lines = (text: ReturnType<Runtime["readText"]>): readonly string[] =>
  text.ok ? text.value.split("\n").filter((line) => line.trim() !== "") : [];

const recordedKeys = (runtime: Store, paths: FmPaths): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const line of lines(runtime.readText(paths.log))) {
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["event"] !== HORIZON_EVENT || parsed.value["source"] !== "scope") continue;
    const { task, file, approvedAt } = parsed.value;
    if (typeof task === "string" && typeof file === "string" && typeof approvedAt === "string")
      keys.add(`${task}|${file}|${approvedAt}`);
  }
  return keys;
};

export const amendedWithCheck = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): boolean =>
  lines(runtime.readText(amendmentsPath(paths))).some((line) => {
    const parsed = parseJsonObject(line);
    return parsed.ok && parsed.value["task"] === task && typeof parsed.value["approvedBy"] === "string";
  });

export const recordScopeAdditions = (runtime: Store, paths: FmPaths, addition: ScopeAddition): number => {
  if (addition.files.length === 0) return 0;
  const seen = recordedKeys(runtime, paths);
  const fresh = addition.files.filter((file) => !seen.has(`${addition.task}|${file}|${addition.approvedAt}`));
  const criterion: Criterion = amendedWithCheck(runtime, paths, addition.task) ? "check" : "none";
  for (const file of fresh) {
    recordHorizon(runtime, paths, {
      source: "scope",
      criterion,
      domain: domainOfText(file),
      task: addition.task,
      file,
      approvedAt: addition.approvedAt,
    });
  }
  return fresh.length;
};
