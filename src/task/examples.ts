import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import type { YamlValue } from "../core/yaml/scalar.js";
import { stringifyYaml } from "../core/yaml/write.js";
import type { FmPaths } from "./paths.js";
import { readTrust, writeTrust } from "./state.js";
import type { TaskContract } from "./types.js";

export const BEHAVIOR_FEATURE = "behavior-contract";
export const MAX_EXAMPLES = 8;
export const EXAMPLE_STATUSES = ["proposed", "approved", "rejected"] as const;

export type ExampleStatus = (typeof EXAMPLE_STATUSES)[number];

export interface Example {
  readonly id: string;
  readonly says: string;
  readonly run: string;
  readonly input?: string;
  readonly expect: string;
  readonly status: ExampleStatus;
}

export type ExampleDraft = Omit<Example, "id" | "status">;

const EXAMPLE_ID = /^E[0-9]{1,3}$/;

export const examplesRelative = (task: string): string => `.finitemonkey/tasks/${task}/examples.yml`;

export const examplesPath = (paths: FmPaths, task: string): AbsolutePath =>
  toAbsolutePath(join(paths.dir, "tasks", task, "examples.yml"));

export const examplesLockKey = (task: string): string => `${task}#examples`;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : typeof value === "number" ? String(value) : undefined;

const toExample = (value: unknown): Example | undefined => {
  if (!isRecord(value)) return undefined;
  const id = text(value["id"]);
  const says = text(value["says"]);
  const run = text(value["run"]);
  const expected = value["expect"];
  const expect = typeof expected === "number" ? String(expected) : typeof expected === "string" ? expected : undefined;
  const status = EXAMPLE_STATUSES.find((item) => item === value["status"]) ?? "proposed";
  const input = text(value["input"]);
  if (id === undefined || !EXAMPLE_ID.test(id) || says === undefined || run === undefined || expect === undefined)
    return undefined;
  return { id, says, run, expect, status, ...(input === undefined ? {} : { input }) };
};

export const parseExamples = (source: string): readonly Example[] => {
  const yaml = parseYaml(source);
  const list = yaml.ok && isRecord(yaml.value) ? yaml.value["examples"] : undefined;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.flatMap((item: unknown) => {
    const example = toExample(item);
    if (example === undefined || seen.has(example.id)) return [];
    seen.add(example.id);
    return [example];
  });
};

const exampleYaml = (example: Example): YamlValue => ({
  id: example.id,
  says: example.says,
  run: example.run,
  ...(example.input === undefined ? {} : { input: example.input }),
  expect: example.expect,
  status: example.status,
});

export const examplesYaml = (examples: readonly Example[]): string =>
  stringifyYaml({ examples: examples.map(exampleYaml) });

export const approvedOnly = (examples: readonly Example[]): readonly Example[] =>
  examples.filter((example) => example.status === "approved");

export const examplesFingerprint = (examples: readonly Example[]): readonly (readonly string[])[] =>
  approvedOnly(examples).map((example) => [example.id, example.says, example.run, example.input ?? "", example.expect]);

export const readExamples = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): readonly Example[] => {
  const read = runtime.readText(examplesPath(paths, task));
  return read.ok ? parseExamples(read.value) : [];
};

export const approvedExamples = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  task: string,
): { readonly examples: readonly Example[]; readonly text: string | undefined } => {
  const locked = readTrust(runtime, paths).approved[examplesLockKey(task)];
  return locked === undefined ? { examples: [], text: undefined } : { examples: parseExamples(locked), text: locked };
};

const writeExamples = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  paths: FmPaths,
  task: string,
  examples: readonly Example[],
): Parsed<string> => {
  const target = examplesPath(paths, task);
  runtime.mkdir(toAbsolutePath(dirname(target)));
  const body = examplesYaml(examples);
  const wrote = runtime.writeText(target, body);
  return wrote.ok ? accept(body) : reject(wrote.error);
};

export type ExampleProblem = "full" | "write";

export const proposeExample = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  paths: FmPaths,
  task: string,
  draft: ExampleDraft,
): Parsed<Example, ExampleProblem> => {
  const current = readExamples(runtime, paths, task);
  const live = current.filter((example) => example.status !== "rejected");
  if (live.length >= MAX_EXAMPLES) return reject("full");
  const next = Math.max(0, ...current.map((example) => Number.parseInt(example.id.slice(1), 10))) + 1;
  const example: Example = { id: `E${String(next)}`, status: "proposed", ...draft };
  const wrote = writeExamples(runtime, paths, task, [...current, example]);
  return wrote.ok ? accept(example) : reject("write");
};

export interface Decision {
  readonly approve: readonly string[];
  readonly reject: readonly string[];
}

export type DecideProblem =
  | { readonly kind: "unknown"; readonly ids: readonly string[] }
  | { readonly kind: "write" }
  | { readonly kind: "no_task" };

const decided = (example: Example, decision: Decision): Example => {
  if (decision.approve.includes(example.id)) return { ...example, status: "approved" };
  if (decision.reject.includes(example.id)) return { ...example, status: "rejected" };
  return example;
};

export const decideExamples = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  paths: FmPaths,
  contract: TaskContract,
  decision: Decision,
  hashOf: (contract: TaskContract, examples: readonly Example[]) => string,
): Parsed<readonly Example[], DecideProblem> => {
  const current = readExamples(runtime, paths, contract.id);
  const known = new Set(current.map((example) => example.id));
  const unknown = [...decision.approve, ...decision.reject].filter((id) => !known.has(id));
  if (unknown.length > 0) return reject({ kind: "unknown", ids: unknown });
  const next = current.map((example) => decided(example, decision));
  const wrote = writeExamples(runtime, paths, contract.id, next);
  if (!wrote.ok) return reject({ kind: "write" });
  const lock = readTrust(runtime, paths);
  const approved = approvedOnly(next);
  const locked = examplesYaml(approved);
  const saved = writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [contract.id]: hashOf(contract, approved) },
    approved: { ...lock.approved, [examplesLockKey(contract.id)]: locked },
  });
  return saved.ok ? accept(next) : reject({ kind: "write" });
};
