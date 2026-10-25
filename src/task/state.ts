import { isRecord, type JsonObject, type Parsed, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "./paths.js";

export interface BlockCounter {
  readonly task: string;
  readonly signature: string;
  readonly consecutive: number;
  readonly same: number;
}

export interface TaskState {
  readonly active?: string;
  readonly done: readonly string[];
  readonly blocks?: BlockCounter;
  readonly snapshot?: JsonObject;
}

const toCounter = (value: unknown): BlockCounter | undefined => {
  if (!isRecord(value)) return undefined;
  const { task, signature, consecutive, same } = value;
  return typeof task === "string" &&
    typeof signature === "string" &&
    typeof consecutive === "number" &&
    typeof same === "number"
    ? { task, signature, consecutive, same }
    : undefined;
};

export interface GateTrust {
  readonly contracts: Readonly<Record<string, string>>;
  readonly approved: Readonly<Record<string, string>>;
  readonly configs: Readonly<Record<string, string>>;
}

const textRecord = (value: unknown): Readonly<Record<string, string>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

export const readJsonFile = (runtime: Pick<Runtime, "readText">, path: FmPaths["state"]): JsonObject | undefined => {
  const text = runtime.readText(path);
  if (!text.ok) return undefined;
  const parsed = parseJsonObject(text.value);
  return parsed.ok ? parsed.value : undefined;
};

export const writeJsonFile = (
  runtime: Pick<Runtime, "writeText">,
  path: FmPaths["state"],
  value: JsonObject,
): Parsed<true> => runtime.writeText(path, `${JSON.stringify({ schemaVersion: 1, ...value }, null, 2)}\n`);

export const readState = (runtime: Pick<Runtime, "readText">, paths: FmPaths): TaskState => {
  const raw = readJsonFile(runtime, paths.state);
  const active = raw?.["active"];
  const done = raw?.["done"];
  const blocks = toCounter(raw?.["blocks"]);
  const snapshot = raw?.["snapshot"];
  return {
    ...(typeof active === "string" ? { active } : {}),
    done: Array.isArray(done) ? done.filter((item): item is string => typeof item === "string") : [],
    ...(blocks === undefined ? {} : { blocks }),
    ...(isRecord(snapshot) ? { snapshot } : {}),
  };
};

export const writeState = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, state: TaskState): Parsed<true> =>
  writeJsonFile(runtime, paths.state, { ...state });

export const readTrust = (runtime: Pick<Runtime, "readText">, paths: FmPaths): GateTrust => {
  const raw = readJsonFile(runtime, paths.trust);
  return {
    contracts: textRecord(raw?.["contracts"]),
    approved: textRecord(raw?.["approved"]),
    configs: textRecord(raw?.["configs"]),
  };
};

export const writeTrust = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, lock: GateTrust): Parsed<true> =>
  writeJsonFile(runtime, paths.trust, { contracts: lock.contracts, approved: lock.approved, configs: lock.configs });

interface StateParts {
  readonly active: string | undefined;
  readonly done: readonly string[];
  readonly blocks: BlockCounter | undefined;
  readonly snapshot: JsonObject | undefined;
}

const assemble = (parts: StateParts): TaskState => ({
  ...(parts.active === undefined ? {} : { active: parts.active }),
  done: parts.done,
  ...(parts.blocks === undefined ? {} : { blocks: parts.blocks }),
  ...(parts.snapshot === undefined ? {} : { snapshot: parts.snapshot }),
});

const partsOf = (state: TaskState): StateParts => ({
  active: state.active,
  done: state.done,
  blocks: state.blocks,
  snapshot: state.snapshot,
});

export const withBlocks = (state: TaskState, blocks: BlockCounter | undefined): TaskState =>
  assemble({ ...partsOf(state), blocks });

export const closeTask = (state: TaskState, id: string): TaskState =>
  assemble({
    ...partsOf(state),
    active: state.active === id ? undefined : state.active,
    blocks: state.active === id ? undefined : state.blocks,
    done: [...new Set([...state.done, id])],
  });
