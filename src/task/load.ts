import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { sha256Hex as sha256 } from "../secrets/fingerprint.js";
import { approvedExamples, type Example, examplesFingerprint, examplesRelative, parseExamples } from "./examples.js";
import { IMPLICIT_ID, implicitContract, type ProjectFiles } from "./implicit.js";
import type { FmPaths } from "./paths.js";
import { type GateTrust, readState, readTrust } from "./state.js";
import { TASK_ID, type TaskContract } from "./types.js";
import { validateContract } from "./validate.js";

export type ContractSource = "lock" | "base" | "disk" | "implicit";

export interface LoadedContract {
  readonly contract: TaskContract;
  readonly hash: string;
  readonly trusted: boolean;
  readonly source: ContractSource;
  readonly editedOnDisk: boolean;
  readonly examples?: readonly Example[];
  readonly examplesEdited?: boolean;
}

export type LoadProblem =
  | { readonly kind: "not_found"; readonly id: string }
  | { readonly kind: "invalid"; readonly id: string; readonly issues: readonly string[] };

export interface ContractSources {
  readonly disk: (relative: string) => string | undefined;
  readonly base: (relative: string) => string | undefined;
}

type Files = Pick<Runtime, "readText">;

const criteria = (contract: TaskContract): readonly (readonly string[])[] =>
  contract.acceptance.map((check) => [check.id, check.kind, check.run ?? ""]);

export const contractHash = (contract: TaskContract, examples: readonly Example[] = []): string => {
  const behavior = examplesFingerprint(examples);
  return sha256(JSON.stringify(behavior.length === 0 ? criteria(contract) : [criteria(contract), behavior]));
};

export const taskRelative = (id: string): string => `.finitemonkey/tasks/${id}.yml`;

export const parseContract = (id: string, text: string): Parsed<TaskContract, LoadProblem> => {
  const yaml = parseYaml(text);
  if (!yaml.ok)
    return reject({ kind: "invalid", id, issues: [`line ${String(yaml.error.line)}: ${yaml.error.message}`] });
  const valid = validateContract(yaml.value);
  if (!valid.ok) return reject({ kind: "invalid", id, issues: valid.error });
  if (valid.value.id !== id) return reject({ kind: "invalid", id, issues: [`id: must match the file name (${id})`] });
  return accept(valid.value);
};

const examplesEdited = (disk: string | undefined, approved: readonly Example[]): boolean =>
  disk === undefined ||
  JSON.stringify(examplesFingerprint(parseExamples(disk))) !== JSON.stringify(examplesFingerprint(approved));

const pick = (
  lock: GateTrust,
  sources: ContractSources,
  id: string,
): { readonly text: string; readonly source: ContractSource } | undefined => {
  const approved = lock.approved[id];
  if (approved !== undefined) return { text: approved, source: "lock" };
  const base = sources.base(taskRelative(id));
  if (base !== undefined) return { text: base, source: "base" };
  const disk = sources.disk(taskRelative(id));
  return disk === undefined ? undefined : { text: disk, source: "disk" };
};

export const loadTask = (
  files: Files,
  paths: FmPaths,
  sources: ContractSources,
  id: string,
): Parsed<LoadedContract, LoadProblem> => {
  if (!TASK_ID.test(id)) return reject({ kind: "not_found", id });
  const lock = readTrust(files, paths);
  const chosen = pick(lock, sources, id);
  if (chosen === undefined) return reject({ kind: "not_found", id });
  const parsed = parseContract(id, chosen.text);
  if (!parsed.ok) return parsed;
  const behavior = approvedExamples(files, paths, id);
  const hash = contractHash(parsed.value, behavior.examples);
  const disk = sources.disk(taskRelative(id));
  const examplesDisk = sources.disk(examplesRelative(id));
  return accept({
    contract: parsed.value,
    hash,
    trusted: chosen.source === "lock" && lock.contracts[id] === hash,
    source: chosen.source,
    editedOnDisk: disk !== undefined && disk !== chosen.text,
    ...(behavior.text === undefined
      ? {}
      : { examples: behavior.examples, examplesEdited: examplesEdited(examplesDisk, behavior.examples) }),
  });
};

export const loadImplicit = (files: Files, paths: FmPaths, project: ProjectFiles): LoadedContract => {
  const contract = implicitContract(project);
  const hash = contractHash(contract);
  const commands = contract.acceptance.filter((check) => check.run !== undefined);
  const trusted = commands.length === 0 || readTrust(files, paths).contracts[IMPLICIT_ID] === hash;
  return { contract, hash, trusted, source: "implicit", editedOnDisk: false };
};

export const activeTaskId = (files: Files, paths: FmPaths, explicit?: string): string | undefined =>
  explicit ?? readState(files, paths).active;
