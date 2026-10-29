import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readState, readTrust, writeTrust } from "../task/state.js";
import { type JsonSchema, validate } from "./schema-check.js";
import { type StateSpec, UI_STATES, type UiState } from "./states.js";

export const UI_CONTRACT_FEATURE = "ui-contract";

const text = { type: "string", minLength: 1 } as const;

export const UI_CONTRACT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ui"],
  properties: {
    ui: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["screen"],
        properties: {
          screen: text,
          primary_action: {
            type: "object",
            additionalProperties: false,
            required: ["role", "name"],
            properties: { role: text, name: text },
          },
          states: { type: "array", items: { type: "string", enum: UI_STATES } },
          mocks: { type: "object", additionalProperties: text },
          back: text,
          steps_max: { type: "integer", minimum: 1 },
          tokens: text,
          dialogs: { type: "array", items: text },
          terminal: { type: "boolean" },
          forms: { type: "array", items: text },
          destructive: { type: "array", items: text },
        },
      },
    },
  },
};

export interface PrimaryAction {
  readonly role: string;
  readonly name: string;
}

export interface UiScreen {
  readonly screen: string;
  readonly primaryAction: PrimaryAction | undefined;
  readonly states: readonly UiState[];
  readonly mocks: Readonly<Record<string, string>>;
  readonly back: string | undefined;
  readonly stepsMax: number | undefined;
  readonly tokens: string | undefined;
  readonly dialogs: readonly string[];
  readonly terminal: boolean;
  readonly forms: readonly string[];
  readonly destructive: readonly string[];
}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const optional = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const screenOf = (value: unknown): UiScreen | undefined => {
  if (!isRecord(value) || typeof value["screen"] !== "string") return undefined;
  const action = value["primary_action"];
  const mocks = value["mocks"];
  return {
    screen: value["screen"],
    primaryAction:
      isRecord(action) && typeof action["role"] === "string" && typeof action["name"] === "string"
        ? { role: action["role"], name: action["name"] }
        : undefined,
    states: strings(value["states"]).flatMap((name) => UI_STATES.find((state) => state === name) ?? []),
    mocks: isRecord(mocks)
      ? Object.fromEntries(
          Object.entries(mocks).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : {},
    back: optional(value["back"]),
    stepsMax: typeof value["steps_max"] === "number" ? value["steps_max"] : undefined,
    tokens: optional(value["tokens"]),
    dialogs: strings(value["dialogs"]),
    terminal: value["terminal"] === true,
    forms: strings(value["forms"]),
    destructive: strings(value["destructive"]),
  };
};

export const parseUiContract = (source: string): Parsed<readonly UiScreen[], readonly string[]> => {
  const yaml = parseYaml(source);
  if (!yaml.ok) return reject([`$: ${yaml.error.message}`]);
  const errors = validate(UI_CONTRACT_SCHEMA, yaml.value);
  if (errors.length > 0) return reject(errors);
  const list = isRecord(yaml.value) ? yaml.value["ui"] : undefined;
  return accept(Array.isArray(list) ? list.flatMap((item: unknown) => screenOf(item) ?? []) : []);
};

export const uiContractRelative = (task: string): string => `.finitemonkey/tasks/${task}/ui.yml`;

export const uiContractPath = (paths: FmPaths, task: string): AbsolutePath =>
  toAbsolutePath(join(paths.dir, "tasks", task, "ui.yml"));

export const uiLockKey = (task: string): string => `${task}#ui`;

export const uiHash = (source: string): string => sha256Hex(source).slice(0, 16);

export interface UiContractState {
  readonly task: string;
  readonly hash: string | undefined;
  readonly approvedHash: string | undefined;
  readonly approved: boolean;
  readonly screens: readonly UiScreen[];
  readonly errors: readonly string[];
}

export const uiContractState = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): UiContractState => {
  const current = runtime.readText(uiContractPath(paths, task));
  const locked = readTrust(runtime, paths).approved[uiLockKey(task)];
  const source = current.ok ? current.value : undefined;
  const parsed = source === undefined ? undefined : parseUiContract(source);
  return {
    task,
    hash: source === undefined ? undefined : uiHash(source),
    approvedHash: locked === undefined ? undefined : uiHash(locked),
    approved: source !== undefined && locked === source,
    screens: parsed?.ok === true ? parsed.value : [],
    errors: parsed !== undefined && !parsed.ok ? parsed.error : [],
  };
};

export const proposeUi = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  paths: FmPaths,
  task: string,
  source: string,
): Parsed<string, readonly string[]> => {
  const parsed = parseUiContract(source);
  if (!parsed.ok) return parsed;
  const target = uiContractPath(paths, task);
  runtime.mkdir(toAbsolutePath(dirname(target)));
  const wrote = runtime.writeText(target, source);
  return wrote.ok ? accept(uiHash(source)) : reject([wrote.error]);
};

export type ApproveProblem = "missing" | "invalid" | "hash" | "write";

export const approveUi = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  task: string,
  hash: string | undefined,
): Parsed<string, ApproveProblem> => {
  const current = runtime.readText(uiContractPath(paths, task));
  if (!current.ok) return reject("missing");
  if (!parseUiContract(current.value).ok) return reject("invalid");
  if (hash !== undefined && hash !== uiHash(current.value)) return reject("hash");
  const lock = readTrust(runtime, paths);
  const saved = writeTrust(runtime, paths, {
    ...lock,
    approved: { ...lock.approved, [uiLockKey(task)]: current.value },
  });
  return saved.ok ? accept(uiHash(current.value)) : reject("write");
};

export const activeUiScreens = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly UiScreen[] => {
  const task = readState(runtime, paths).active;
  if (task === undefined) return [];
  const state = uiContractState(runtime, paths, task);
  return state.approved ? state.screens : [];
};

export const contractStates = (
  screens: readonly UiScreen[],
  mapped: Readonly<Record<string, readonly StateSpec[]>>,
): Readonly<Record<string, readonly StateSpec[]>> => {
  const out: Record<string, readonly StateSpec[]> = { ...mapped };
  for (const screen of screens.filter((item) => item.screen.startsWith("/") && item.states.length > 0)) {
    const declared = mapped[screen.screen] ?? [];
    out[screen.screen] = screen.states.map(
      (state) => declared.find((spec) => spec.state === state) ?? { state, mock: screen.mocks[state] },
    );
  }
  return out;
};

export const contractDialogs = (
  screens: readonly UiScreen[],
  mapped: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> => {
  const out: Record<string, readonly string[]> = { ...mapped };
  for (const screen of screens.filter((item) => item.dialogs.length > 0))
    out[screen.screen] = [...new Set([...(mapped[screen.screen] ?? []), ...screen.dialogs])];
  return out;
};
