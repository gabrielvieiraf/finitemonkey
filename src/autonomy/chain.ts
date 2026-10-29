import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { logEvent } from "../evidence/log.js";
import type { AutonomyConfig } from "../policy/policy.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { readLedger as readSpend } from "../spend/ledger.js";
import { examplesPath } from "../task/examples.js";
import { contractHash } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { contractYaml } from "../task/serialize.js";
import { readState, readTrust, writeJsonFile, writeState, writeTrust } from "../task/state.js";
import type { AcceptanceCheck, TaskContract } from "../task/types.js";
import { HOLD_EVENT, UNATTENDED_FILE } from "./hold.js";

export type GateStatus = "passed" | "failed" | "unverified";

export interface UnattendedDeps {
  readonly agent: (task: TaskContract, timeoutMs: number) => boolean;
  readonly gate: (task: string) => GateStatus;
}

export type ItemStatus = "proven" | "unproven" | "invalidated";

export interface ItemResult {
  readonly task: string;
  readonly status: ItemStatus;
  readonly why: string;
}

export interface MorningReport {
  readonly run: string;
  readonly contract: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly items: readonly ItemResult[];
  readonly holds: readonly { readonly reason: string; readonly command: string }[];
  readonly stoppedBy: string | null;
}

export type ChainRuntime = Pick<Runtime, "readText" | "writeText" | "appendText" | "now">;

export const subcontracts = (
  contract: TaskContract,
  pieces: readonly (readonly AcceptanceCheck[])[],
): readonly TaskContract[] =>
  pieces.length <= 1
    ? [contract]
    : pieces.map((acceptance, index) => ({
        ...contract,
        id: `${contract.id}-u${String(index + 1)}`,
        goal: `${contract.goal} (part ${String(index + 1)} of ${String(pieces.length)})`,
        size: "S",
        acceptance,
      }));

export const fixContracts = (
  runtime: ChainRuntime,
  paths: FmPaths,
  contracts: readonly TaskContract[],
): Readonly<Record<string, string>> => {
  const trust = readTrust(runtime, paths);
  const texts = contracts.map((contract) => {
    const text = stringifyYaml(contractYaml(contract));
    if (!runtime.readText(paths.task(contract.id)).ok) runtime.writeText(paths.task(contract.id), text);
    return [contract.id, runtime.readText(paths.task(contract.id))] as const;
  });
  writeTrust(runtime, paths, {
    ...trust,
    contracts: {
      ...trust.contracts,
      ...Object.fromEntries(contracts.map((contract) => [contract.id, contractHash(contract)])),
    },
  });
  return Object.fromEntries(texts.map(([id, text]) => [paths.task(id), text.ok ? sha256Hex(text.value) : "-"]));
};

const hashOf = (runtime: Pick<Runtime, "readText">, path: AbsolutePath): string => {
  const text = runtime.readText(path);
  return text.ok ? sha256Hex(text.value) : "-";
};

const fixedStill = (runtime: ChainRuntime, fixed: Readonly<Record<string, string>>): boolean =>
  Object.entries(fixed).every(([path, hash]) => {
    const text = runtime.readText(toAbsolutePath(path));
    return (text.ok ? sha256Hex(text.value) : "-") === hash;
  });

const spentSince = (runtime: ChainRuntime, paths: FmPaths, since: string): number =>
  Object.values(readSpend(runtime, paths).messages)
    .filter((message) => message.at >= since)
    .reduce((sum, message) => sum + message.usd, 0);

const holdsDuring = (runtime: ChainRuntime, paths: FmPaths, run: string): MorningReport["holds"] => {
  const text = runtime.readText(paths.log);
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    if (!line.includes(HOLD_EVENT)) return [];
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["event"] !== HOLD_EVENT || parsed.value["run"] !== run) return [];
    const { reason, command } = parsed.value;
    return typeof reason === "string" && typeof command === "string" ? [{ reason, command }] : [];
  });
};

interface Step {
  readonly item: ItemResult;
  readonly stop?: string;
}

const stepOne = (
  runtime: ChainRuntime,
  paths: FmPaths,
  deps: UnattendedDeps,
  context: {
    readonly fixed: Readonly<Record<string, string>>;
    readonly deadline: number;
    readonly config: AutonomyConfig;
    readonly startedAt: string;
  },
  contract: TaskContract,
): Step => {
  const id = contract.id;
  if (nowMs(runtime) >= context.deadline) return { item: { task: id, status: "unproven", why: "time" }, stop: "time" };
  if (spentSince(runtime, paths, context.startedAt) >= context.config.maxUsd)
    return { item: { task: id, status: "unproven", why: "budget" }, stop: "budget" };
  writeState(runtime, paths, { ...readState(runtime, paths), active: id });
  deps.agent(contract, context.deadline - nowMs(runtime));
  if (!fixedStill(runtime, context.fixed))
    return { item: { task: id, status: "invalidated", why: "criteria_changed" }, stop: "criteria_changed" };
  const gate = deps.gate(id);
  if (gate === "passed") return { item: { task: id, status: "proven", why: "gate_passed" } };
  return { item: { task: id, status: "invalidated", why: `gate_${gate}` }, stop: `gate_${gate}` };
};

export const runChain = (
  runtime: ChainRuntime,
  paths: FmPaths,
  deps: UnattendedDeps,
  config: AutonomyConfig,
  parent: TaskContract,
  contracts: readonly TaskContract[],
  onStart: (run: string) => void = () => undefined,
): MorningReport => {
  const startedAt = runtime.now();
  const run = `u${sha256Hex(`${parent.id}\u0000${startedAt}`).slice(0, 10)}`;
  onStart(run);
  const examples = examplesPath(paths, parent.id);
  const fixed = { ...fixContracts(runtime, paths, contracts), [examples]: hashOf(runtime, examples) };
  const deadline = nowMs(runtime) + config.maxMinutes * 60_000;
  writeJsonFile(runtime, paths.cache(UNATTENDED_FILE), { run, until: new Date(deadline).toISOString() });
  logEvent(runtime, paths, "unattended_start", { run, contract: parent.id, parts: contracts.length });
  const items: ItemResult[] = [];
  let stoppedBy: string | null = null;
  try {
    for (const contract of contracts) {
      if (stoppedBy !== null) {
        items.push({ task: contract.id, status: "unproven", why: `stopped_${stoppedBy}` });
        continue;
      }
      const step = stepOne(runtime, paths, deps, { fixed, deadline, config, startedAt }, contract);
      items.push(step.item);
      if (step.stop !== undefined) stoppedBy = step.stop;
    }
  } finally {
    writeJsonFile(runtime, paths.cache(UNATTENDED_FILE), {});
  }
  const report: MorningReport = {
    run,
    contract: parent.id,
    startedAt,
    endedAt: runtime.now(),
    items,
    holds: holdsDuring(runtime, paths, run),
    stoppedBy,
  };
  writeJsonFile(runtime, toAbsolutePath(join(paths.dir, "reports", `unattended-${run}.json`)), { ...report });
  logEvent(runtime, paths, "unattended_end", {
    run,
    stoppedBy,
    proven: items.filter((item) => item.status === "proven").length,
  });
  return report;
};
