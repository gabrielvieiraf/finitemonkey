import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Mutant } from "./operators.js";

export const TOOL_REPORT = "reports/mutation/mutation.json";

const KILLED = new Set(["Killed", "Timeout"]);
const SURVIVED = new Set(["Survived", "NoCoverage"]);

export interface ToolCounts {
  readonly killed: number;
  readonly survived: readonly Mutant[];
}

const lineOf = (location: unknown): number => {
  const start = isRecord(location) ? location["start"] : undefined;
  const line = isRecord(start) ? start["line"] : undefined;
  return typeof line === "number" ? line : 0;
};

const mutantsIn = (file: string, entry: unknown): readonly { status: string; mutant: Mutant }[] => {
  const list = isRecord(entry) ? entry["mutants"] : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item["status"] !== "string") return [];
    const operator = typeof item["mutatorName"] === "string" ? item["mutatorName"] : "mutant";
    const line = lineOf(item["location"]);
    return [{ status: item["status"], mutant: { file, line, operator, original: "", mutated: "" } }];
  });
};

export const parseToolReport = (text: string): ToolCounts | undefined => {
  const parsed = parseJsonObject(text);
  const files = parsed.ok ? parsed.value["files"] : undefined;
  if (!isRecord(files)) return undefined;
  const all = Object.entries(files).flatMap(([file, entry]) => mutantsIn(file, entry));
  return {
    killed: all.filter((item) => KILLED.has(item.status)).length,
    survived: all.filter((item) => SURVIVED.has(item.status)).map((item) => item.mutant),
  };
};
