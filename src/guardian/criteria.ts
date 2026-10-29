import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

const FILE = "guardian-criteria.json";
const MARKER = /^\s*finitemonkey:\s*criterion\s+(\S.*)$/im;

export interface CriteriaState {
  readonly pending?: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export const readCriteria = (runtime: Pick<Runtime, "readText">, paths: FmPaths): CriteriaState => {
  const raw = readJsonFile(runtime, paths.cache(FILE));
  const criteria = isRecord(raw?.["criteria"])
    ? Object.fromEntries(
        Object.entries(raw["criteria"]).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};
  const pending = raw?.["pending"];
  return { criteria, ...(typeof pending === "string" ? { pending } : {}) };
};

export const writeCriteria = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, state: CriteriaState): void => {
  writeJsonFile(runtime, paths.cache(FILE), { ...state });
};

export const criterionFrom = (prompt: string): string | undefined => MARKER.exec(prompt)?.[1]?.trim();

export const criterionPrompt: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const text = criterionFrom(prompt);
  const paths = projectPaths(input);
  if (text === undefined || paths === undefined || !comesFromPerson(prompt)) return { kind: "allow" };
  const state = readCriteria(input.runtime, paths);
  if (state.pending === undefined) return { kind: "allow" };
  writeCriteria(input.runtime, paths, { criteria: { ...state.criteria, [state.pending]: text } });
  return { kind: "allow" };
};
