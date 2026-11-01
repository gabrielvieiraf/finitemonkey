import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";
import type { Arm } from "./bench-arms.js";
import type { Family, Persona } from "./bench-family.js";
import { ONBOARDING, type Onboarding } from "./bench-harness.js";
import { plan, type PlannedRun } from "./bench-plan.js";

export const PHASES_DIR = "phases";

export interface PhaseGroup {
  readonly name: string;
  readonly families: readonly string[];
  readonly personas: readonly string[];
  readonly arms: readonly string[];
  readonly repeats: number;
}

export interface Pilot {
  readonly source: string;
  readonly costUsd: Readonly<Record<"plain" | "fm", number>>;
  readonly seconds: Readonly<Record<"plain" | "fm", number>>;
}

export interface Phase {
  readonly id: string;
  readonly description: string;
  readonly onboard: Onboarding;
  readonly maxBudgetUsd: number;
  readonly capUsd: number;
  readonly pilot: Pilot;
  readonly multiplier: readonly [number, number];
  readonly groups: readonly PhaseGroup[];
}

const strings = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string") ? value : undefined;

const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const pair = (raw: unknown): Readonly<Record<"plain" | "fm", number>> | undefined => {
  if (!isRecord(raw)) return undefined;
  const plain = positive(raw["plain"]);
  const fm = positive(raw["fm"]);
  return plain === undefined || fm === undefined ? undefined : { plain, fm };
};

const groupOf = (raw: unknown): Parsed<PhaseGroup> => {
  if (!isRecord(raw)) return reject("each group must be an object");
  const name = raw["name"];
  const families = strings(raw["families"]);
  const personas = strings(raw["personas"]);
  const arms = strings(raw["arms"]);
  const repeats = raw["repeats"];
  if (typeof name !== "string" || families === undefined || personas === undefined || arms === undefined) {
    return reject("a group needs a name and non-empty families, personas and arms");
  }
  if (typeof repeats !== "number" || !Number.isInteger(repeats) || repeats < 1) {
    return reject(`group ${name}: repeats must be a whole number of at least 1`);
  }
  return accept({ name, families, personas, arms, repeats });
};

export const parsePhase = (record: JsonObject): Parsed<Phase> => {
  const { id, description } = record;
  if (typeof id !== "string" || typeof description !== "string") return reject("a phase needs an id and a description");
  const onboard = ONBOARDING.find((option) => option === record["onboard"]);
  if (onboard === undefined) return reject(`${id}: onboard must be ${ONBOARDING.join(" or ")}`);
  const maxBudgetUsd = positive(record["maxBudgetUsd"]);
  const capUsd = positive(record["capUsd"]);
  if (maxBudgetUsd === undefined || capUsd === undefined)
    return reject(`${id}: maxBudgetUsd and capUsd must be positive`);
  const pilotRaw = record["pilot"];
  const costUsd = isRecord(pilotRaw) ? pair(pilotRaw["costUsd"]) : undefined;
  const seconds = isRecord(pilotRaw) ? pair(pilotRaw["seconds"]) : undefined;
  const source = isRecord(pilotRaw) ? pilotRaw["source"] : undefined;
  if (costUsd === undefined || seconds === undefined || typeof source !== "string") {
    return reject(`${id}: pilot needs a source and plain and fm costUsd and seconds`);
  }
  const multiplierRaw = record["multiplier"];
  const low = Array.isArray(multiplierRaw) ? positive(multiplierRaw[0]) : undefined;
  const high = Array.isArray(multiplierRaw) ? positive(multiplierRaw[1]) : undefined;
  if (low === undefined || high === undefined || low > high) return reject(`${id}: multiplier must be [low, high]`);
  const groupsRaw = Array.isArray(record["groups"]) ? record["groups"] : [];
  if (groupsRaw.length === 0) return reject(`${id}: a phase needs at least one group`);
  const groups: PhaseGroup[] = [];
  for (const raw of groupsRaw) {
    const group = groupOf(raw);
    if (!group.ok) return reject(`${id}: ${group.error}`);
    groups.push(group.value);
  }
  return accept({
    id,
    description,
    onboard,
    maxBudgetUsd,
    capUsd,
    pilot: { source, costUsd, seconds },
    multiplier: [low, high],
    groups,
  });
};

export const loadPhase = (benchDir: string, id: string): Parsed<Phase> => {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) return reject(`unknown phase ${id}`);
  const file = join(benchDir, PHASES_DIR, `${id}.json`);
  if (!existsSync(file)) return reject(`unknown phase ${id}: no bench/${PHASES_DIR}/${id}.json`);
  const parsed = parseJsonObject(readFileSync(file, "utf8"));
  if (!parsed.ok) return reject(`${id}: ${parsed.error}`);
  const phase = parsePhase(parsed.value);
  if (phase.ok && phase.value.id !== id) return reject(`${id}.json: id must be ${id}`);
  return phase;
};

export const phaseProblems = (
  phase: Phase,
  families: readonly Family[],
  personas: readonly Persona[],
  arms: readonly Arm[],
): readonly string[] =>
  phase.groups.flatMap((group) => [
    ...group.families
      .filter((id) => !families.some((family) => family.id === id))
      .map((id) => `group ${group.name}: unknown family ${id}`),
    ...group.personas
      .filter((id) => !personas.some((persona) => persona.id === id))
      .map((id) => `group ${group.name}: unknown persona ${id}`),
    ...group.arms
      .filter((id) => !arms.some((arm) => arm.id === id))
      .map((id) => `group ${group.name}: unknown arm ${id}`),
  ]);

export const groupTasks = (group: PhaseGroup): readonly string[] =>
  group.families.flatMap((family) => group.personas.map((persona) => `${family}.${persona}`));

export const phaseRuns = (phase: Phase, seed: number): readonly PlannedRun[] => {
  const runs: PlannedRun[] = [];
  for (const group of phase.groups) {
    for (const run of plan({ tasks: groupTasks(group), arms: group.arms, repeats: group.repeats, seed })) {
      runs.push({ ...run, order: runs.length });
    }
  }
  return runs;
};

export interface PhaseEstimate {
  readonly sessions: number;
  readonly worstUsd: number;
  readonly expectedUsd: readonly [number, number];
  readonly expectedHours: readonly [number, number];
  readonly withinCap: boolean;
  readonly lines: readonly string[];
}

const kindOf = (arm: Arm | undefined): "plain" | "fm" => (arm?.finitemonkey === true ? "fm" : "plain");

export const phaseEstimate = (
  phase: Phase,
  runs: readonly PlannedRun[],
  arms: readonly Arm[],
  turnsOf: (task: string) => number,
  maxBudgetUsd: number,
): PhaseEstimate => {
  const [low, high] = phase.multiplier;
  let worst = 0;
  let cost = 0;
  let seconds = 0;
  for (const run of runs) {
    const kind = kindOf(arms.find((arm) => arm.id === run.arm));
    worst += turnsOf(run.task) * maxBudgetUsd;
    cost += phase.pilot.costUsd[kind];
    seconds += phase.pilot.seconds[kind];
  }
  const expectedUsd: readonly [number, number] = [cost * low, cost * high];
  const expectedHours: readonly [number, number] = [(seconds * low) / 3600, (seconds * high) / 3600];
  const byGroup = phase.groups.map((group) => {
    const tasks = groupTasks(group);
    const count = runs.filter((run) => tasks.includes(run.task) && group.arms.includes(run.arm)).length;
    return `  ${group.name}: ${String(count)} sessions (${String(group.families.length)} families x ${String(group.personas.length)} persona x ${String(group.arms.length)} arms x ${String(group.repeats)} repeats)`;
  });
  const lines = [
    `phase ${phase.id}: ${String(runs.length)} sessions, onboarding ${phase.onboard}`,
    ...byGroup,
    `expected cost US$ ${expectedUsd[0].toFixed(2)} to ${expectedUsd[1].toFixed(2)}: pilot mean per session (plain US$ ${phase.pilot.costUsd.plain.toFixed(3)}, Finite Monkey US$ ${phase.pilot.costUsd.fm.toFixed(3)}) x ${String(low)} to ${String(high)} for harder tasks, first turn only`,
    `expected wall time ${expectedHours[0].toFixed(1)} to ${expectedHours[1].toFixed(1)} hours, sessions run one at a time`,
    `worst case US$ ${worst.toFixed(2)}: every turn of every session spends --max-budget-usd ${maxBudgetUsd.toFixed(2)} (cap US$ ${phase.capUsd.toFixed(2)})`,
  ];
  return {
    sessions: runs.length,
    worstUsd: worst,
    expectedUsd,
    expectedHours,
    withinCap: worst <= phase.capUsd + 1e-9,
    lines,
  };
};
