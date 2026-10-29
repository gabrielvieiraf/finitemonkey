import type { AbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import { hostOfUrl, isLocal } from "../git/destructive.js";
import { configAt, type ConfigTree } from "../git/project-config.js";
import { type Engine, engineOf } from "./locks.js";

export interface MigrateConfig {
  readonly engine: Engine;
  readonly url: string | undefined;
  readonly reset: string | undefined;
  readonly apply: string | undefined;
  readonly dump: string | undefined;
  readonly down: string | undefined;
  readonly baseTests: string | undefined;
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
  | { readonly kind: "ran"; readonly findings: readonly ThrowawayFinding[]; readonly steps: readonly string[] };

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

export const runThrowaway = (
  runtime: Runtime,
  config: MigrateConfig,
  places: ThrowawayPlaces,
  deadline: number,
): ThrowawayResult => {
  const { url, reset, apply, dump } = config;
  if (url === undefined || apply === undefined) return { kind: "not_configured" };
  if (!isLocalDatabase(url)) return { kind: "refused", url };
  const run = runner(runtime, url, deadline);
  const steps: string[] = [];
  const must = (name: string, command: string | undefined, cwd: AbsolutePath): Step | string => {
    if (command === undefined) return { ok: true, stdout: "", detail: "" };
    steps.push(name);
    const step = run(command, cwd);
    return step.ok ? step : `${name}: ${step.detail}`;
  };
  const unavailable = (failure: string): ThrowawayResult => ({
    kind: "unavailable",
    step: failure.slice(0, failure.indexOf(":")),
    detail: failure,
  });
  const cleared = must("reset", reset, places.root);
  if (typeof cleared === "string") return unavailable(cleared);
  const based = must("apply-base", apply, places.base);
  if (typeof based === "string") return unavailable(based);
  const baseSchema = must("dump-base", dump, places.root);
  if (typeof baseSchema === "string") return unavailable(baseSchema);
  steps.push("apply");
  if (!run(apply, places.root).ok) return { kind: "ran", findings: ["apply-failed"], steps };
  const findings: ThrowawayFinding[] = [];
  if (config.baseTests !== undefined) {
    steps.push("base-tests");
    if (!run(config.baseTests, places.base).ok) findings.push("compat-broken");
  }
  if (config.down !== undefined && dump !== undefined) {
    steps.push("down");
    const down = run(config.down, places.root);
    steps.push("dump-down");
    const after = down.ok ? run(dump, places.root) : undefined;
    if (!after?.ok) findings.push("down-failed");
    else if (typeof baseSchema !== "string" && !sameSchema(baseSchema.stdout, after.stdout)) {
      findings.push("down-mismatch");
    }
  }
  return { kind: "ran", findings, steps };
};
