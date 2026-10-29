import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";
import { GUARD_MODES, type GuardMode } from "../src/policy/policy.js";

export interface Arm {
  readonly id: string;
  readonly description: string;
  readonly finitemonkey: boolean;
  readonly sha: string | undefined;
  readonly guards: Readonly<Record<string, GuardMode>>;
}

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-z][a-z0-9-]*$/;

const guardsOf = (raw: unknown): Parsed<Readonly<Record<string, GuardMode>>> => {
  if (raw === undefined) return accept({});
  if (!isRecord(raw)) return reject("guards must be an object");
  const entries: [string, GuardMode][] = [];
  for (const [id, mode] of Object.entries(raw)) {
    const known = GUARD_MODES.find((option) => option === mode);
    if (known === undefined) return reject(`guard ${id} has an unknown mode`);
    entries.push([id, known]);
  }
  return accept(Object.fromEntries(entries));
};

const shaOf = (raw: unknown): Parsed<string | undefined> => {
  if (raw === null || raw === undefined) return accept(undefined);
  return typeof raw === "string" && SHA.test(raw) ? accept(raw) : reject("sha must be a full commit hash or null");
};

export const parseArm = (record: JsonObject): Parsed<Arm> => {
  const { id, description, finitemonkey } = record;
  if (typeof id !== "string" || !ID.test(id)) return reject("id must be lowercase words joined by dashes");
  if (typeof description !== "string" || description === "") return reject(`${id}: description is required`);
  if (typeof finitemonkey !== "boolean") return reject(`${id}: finitemonkey must be true or false`);
  const sha = shaOf(record["sha"]);
  if (!sha.ok) return reject(`${id}: ${sha.error}`);
  const guards = guardsOf(record["guards"]);
  if (!guards.ok) return reject(`${id}: ${guards.error}`);
  if (!finitemonkey && Object.keys(guards.value).length > 0) return reject(`${id}: guards need finitemonkey`);
  return accept({ id, description, finitemonkey, sha: sha.value, guards: guards.value });
};

export const loadArms = (dir: string): Parsed<readonly Arm[]> => {
  const arms: Arm[] = [];
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()) {
    const parsed = parseJsonObject(readFileSync(join(dir, name), "utf8"));
    if (!parsed.ok) return reject(`${name}: ${parsed.error}`);
    const arm = parseArm(parsed.value);
    if (!arm.ok) return reject(`${name}: ${arm.error}`);
    if (`${arm.value.id}.json` !== name) return reject(`${name}: file name must match id ${arm.value.id}`);
    arms.push(arm.value);
  }
  return accept(arms);
};

export const policyYaml = (arm: Arm): string => {
  const guards = Object.entries(arm.guards).map(([id, mode]) => `  ${id}: ${mode}`);
  return guards.length === 0 ? "" : ["guards:", ...guards, ""].join("\n");
};

export const unpinned = (arms: readonly Arm[]): readonly string[] =>
  arms.filter((arm) => arm.finitemonkey && arm.sha === undefined).map((arm) => arm.id);
