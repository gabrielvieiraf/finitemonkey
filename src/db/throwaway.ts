import type { AbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import { hostOfUrl, isLocal } from "../git/destructive.js";
import { configAt, type ConfigTree } from "../git/project-config.js";
import { type Counts, parseCounts, type RowDrop, rowDrops } from "./counts.js";
import { type Engine, engineOf } from "./locks.js";

export interface MigrateConfig {
  readonly engine: Engine;
  readonly url: string | undefined;
  readonly reset: string | undefined;
  readonly apply: string | undefined;
  readonly dump: string | undefined;
  readonly down: string | undefined;
  readonly baseTests: string | undefined;
  readonly seed: string | undefined;
  readonly counts: string | undefined;
  readonly stats: string | undefined;
}

const text = (config: ConfigTree, key: string): string | undefined => {
  const value = configAt(config, "migrate", key);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

export const migrateConfig = (config: ConfigTree): MigrateConfig => ({
  engine: engineOf(text(config, "engine")),
  url: text(config, "url"),
  reset: text(config, "reset"),
  apply: text(config, "apply"),
  dump: text(config, "dump"),
  down: text(config, "down"),
  baseTests: text(config, "base_tests"),
  seed: text(config, "seed"),
  counts: text(config, "counts"),
  stats: text(config, "stats"),
});

export const isLocalDatabase = (url: string): boolean => {
  const host = hostOfUrl(url);
  return host === undefined ? !/^[a-z][\w+.-]*:\/\/[^/]/i.test(url) : isLocal(host);
};

export type ThrowawayFinding = "apply-failed" | "compat-broken" | "down-mismatch" | "down-failed";

export type ThrowawayResult =
  | { readonly kind: "not_configured" }
  | { readonly kind: "refused"; readonly url: string }
  | { readonly kind: "unavailable"; readonly step: string; readonly detail: string }
  | {
      readonly kind: "ran";
      readonly findings: readonly ThrowawayFinding[];
      readonly steps: readonly string[];
      readonly rows: readonly RowDrop[];
    };

export interface ThrowawayPlaces {
  readonly root: AbsolutePath;
  readonly base: AbsolutePath;
}

const STEP_TIMEOUT_MS = 120_000;
const DETAIL_LIMIT = 300;

interface Step {
  readonly ok: boolean;
  readonly stdout: string;
  readonly detail: string;
}

const runner =
  (runtime: Runtime, url: string, deadline: number) =>
  (command: string, cwd: AbsolutePath): Step => {
    const result = runtime.exec({
      command,
      args: [],
      cwd,
      shell: true,
      timeoutMs: Math.max(1_000, Math.min(STEP_TIMEOUT_MS, deadline - nowMs(runtime))),
      env: { DATABASE_URL: url, FINITEMONKEY_THROWAWAY: "1", CI: "1" },
      unset: ["NODE_TEST_CONTEXT"],
    });
    const ok = result.found && result.exitCode === 0 && !result.timedOut;
    return { ok, stdout: result.stdout, detail: (result.stderr || result.stdout).trim().slice(-DETAIL_LIMIT) };
  };

const sameSchema = (left: string, right: string): boolean =>
  left.replace(/\r\n/g, "\n").trim() === right.replace(/\r\n/g, "\n").trim();

type Run = (command: string, cwd: AbsolutePath) => Step;

interface Prepared {
  readonly steps: string[];
  readonly baseSchema: string | undefined;
  readonly seeded: Counts | undefined;
}

const prepareBase = (run: Run, config: MigrateConfig, places: ThrowawayPlaces): Prepared | ThrowawayResult => {
  const steps: string[] = [];
  const must = (name: string, command: string | undefined, cwd: AbsolutePath): Step | ThrowawayResult => {
    if (command === undefined) return { ok: true, stdout: "", detail: "" };
    steps.push(name);
    const step = run(command, cwd);
    return step.ok ? step : { kind: "unavailable", step: name, detail: `${name}: ${step.detail}` };
  };
  const plan: readonly [string, string | undefined, AbsolutePath][] = [
    ["reset", config.reset, places.root],
    ["apply-base", config.apply, places.base],
    ["seed", config.seed, places.base],
    ["dump-base", config.dump, places.root],
    ["count-base", config.seed === undefined ? undefined : config.counts, places.root],
  ];
  const outputs: string[] = [];
  for (const [name, command, cwd] of plan) {
    const step = must(name, command, cwd);
    if ("kind" in step) return step;
    outputs.push(step.stdout);
  }
  return {
    steps,
    baseSchema: config.dump === undefined ? undefined : outputs[3],
    seeded: steps.includes("count-base") ? parseCounts(outputs[4] ?? "") : undefined,
  };
};

const seededRows = (run: Run, config: MigrateConfig, root: AbsolutePath, prepared: Prepared): readonly RowDrop[] => {
  if (prepared.seeded === undefined || config.counts === undefined) return [];
  prepared.steps.push("count");
  const counted = run(config.counts, root);
  return rowDrops(prepared.seeded, counted.ok ? parseCounts(counted.stdout) : {});
};

const downFindings = (run: Run, config: MigrateConfig, root: AbsolutePath, prepared: Prepared): ThrowawayFinding[] => {
  if (config.down === undefined || config.dump === undefined) return [];
  prepared.steps.push("down", "dump-down");
  const down = run(config.down, root);
  const after = down.ok ? run(config.dump, root) : undefined;
  if (!after?.ok) return ["down-failed"];
  return prepared.baseSchema !== undefined && !sameSchema(prepared.baseSchema, after.stdout) ? ["down-mismatch"] : [];
};

export const runThrowaway = (
  runtime: Runtime,
  config: MigrateConfig,
  places: ThrowawayPlaces,
  deadline: number,
): ThrowawayResult => {
  const { url, apply } = config;
  if (url === undefined || apply === undefined) return { kind: "not_configured" };
  if (!isLocalDatabase(url)) return { kind: "refused", url };
  const run = runner(runtime, url, deadline);
  const prepared = prepareBase(run, config, places);
  if ("kind" in prepared) return prepared;
  prepared.steps.push("apply");
  if (!run(apply, places.root).ok) {
    return { kind: "ran", findings: ["apply-failed"], steps: prepared.steps, rows: [] };
  }
  const rows = seededRows(run, config, places.root, prepared);
  const findings: ThrowawayFinding[] = [];
  if (config.baseTests !== undefined) {
    prepared.steps.push("base-tests");
    if (!run(config.baseTests, places.base).ok) findings.push("compat-broken");
  }
  findings.push(...downFindings(run, config, places.root, prepared));
  return { kind: "ran", findings, steps: prepared.steps, rows };
};
