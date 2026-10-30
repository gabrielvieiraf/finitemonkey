import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { JsonObject } from "../src/core/parsed.js";
import { type Arm, policyYaml } from "./bench-arms.js";
import { buildInvocation, type Invocation, type PinnedPlugin } from "./bench-invoke.js";
import { plan, type PlannedRun } from "./bench-plan.js";
import type { Freeze } from "./bench-prereg.js";
import { checkInjection, type Injection, sessionIdOf, usageOf } from "./bench-transcript.js";

export const RUN_SCHEMA = "finitemonkey/bench-run@1";

export interface BenchTask {
  readonly id: string;
  readonly prompt: (taskSeed: number) => string;
  readonly materialize: (workdir: string, taskSeed: number) => void;
  readonly evaluate?: (workdir: string, taskSeed: number, transcript: string) => JsonObject;
  readonly followUp?: (transcript: string, turn: number, taskSeed: number) => string | undefined;
}

export interface RunOutcome {
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Runner = (invocation: Invocation) => Promise<RunOutcome>;

export interface HarnessDeps {
  readonly runner: Runner;
  readonly claudeVersion: string;
  readonly pluginFor: (arm: Arm) => PinnedPlugin | undefined;
  readonly tempRoot: () => string;
  readonly insideRepo: (dir: string) => boolean;
  readonly now: () => string;
}

export interface HarnessConfig {
  readonly outDir: string;
  readonly seed: number;
  readonly repeats: number;
  readonly model: string;
  readonly maxBudgetUsd: number;
  readonly configDir: string;
  readonly freeze: Freeze;
  readonly tasks: readonly BenchTask[];
  readonly arms: readonly Arm[];
  readonly only?: string;
}

export interface RunRecord extends JsonObject {
  readonly schema: typeof RUN_SCHEMA;
  readonly run: string;
  readonly injection: Injection;
}

export const schedule = (
  config: Pick<HarnessConfig, "tasks" | "arms" | "repeats" | "seed" | "only">,
): readonly PlannedRun[] =>
  plan({
    tasks: config.tasks.map((task) => task.id),
    arms: config.arms.map((arm) => arm.id),
    repeats: config.repeats,
    seed: config.seed,
  }).filter((run) => config.only === undefined || run.id === config.only);

const readIfAny = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");

const prepare = (task: BenchTask, arm: Arm, run: PlannedRun, root: string): string => {
  const workdir = join(root, "project");
  mkdirSync(workdir, { recursive: true });
  task.materialize(workdir, run.taskSeed);
  const policy = policyYaml(arm);
  if (arm.finitemonkey && policy !== "") {
    const file = join(workdir, ".finitemonkey", "policy.yml");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, policy);
  }
  return workdir;
};

const record = (
  config: HarnessConfig,
  deps: HarnessDeps,
  run: PlannedRun,
  arm: Arm,
  outcome: RunOutcome,
  log: string,
): RunRecord => {
  const usage = usageOf(outcome.stdout);
  return {
    schema: RUN_SCHEMA,
    run: run.id,
    task: run.task,
    arm: arm.id,
    armSha: arm.sha ?? null,
    repeat: run.repeat,
    seed: run.seed,
    taskSeed: run.taskSeed,
    order: run.order,
    preregistration: config.freeze.sha256,
    claudeVersion: deps.claudeVersion,
    model: config.model,
    reportedModel: usage.model ?? null,
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    costUsd: usage.costUsd ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    turns: usage.turns ?? null,
    finishedAt: deps.now(),
    injection: checkInjection(arm, run.id, outcome.stdout, log),
  };
};

const converse = async (
  deps: HarnessDeps,
  task: BenchTask,
  run: PlannedRun,
  first: Invocation,
  invoke: (prompt: string, resume: string) => Invocation,
): Promise<{ readonly outcome: RunOutcome; readonly followUps: readonly string[] }> => {
  let outcome = await deps.runner(first);
  const followUps: string[] = [];
  if (task.followUp === undefined) return { outcome, followUps };
  for (;;) {
    const reply = task.followUp(outcome.stdout, followUps.length, run.taskSeed);
    const resume = sessionIdOf(outcome.stdout);
    if (reply === undefined || resume === undefined) return { outcome, followUps };
    followUps.push(reply);
    const next = await deps.runner(invoke(reply, resume));
    outcome = {
      exitCode: next.exitCode,
      durationMs: outcome.durationMs + next.durationMs,
      stdout: `${outcome.stdout.trimEnd()}\n${next.stdout}`,
      stderr: `${outcome.stderr}${next.stderr}`,
    };
  }
};

const runOne = async (
  config: HarnessConfig,
  deps: HarnessDeps,
  run: PlannedRun,
  task: BenchTask,
  arm: Arm,
): Promise<RunRecord> => {
  const root = deps.tempRoot();
  try {
    if (deps.insideRepo(dirname(root))) throw new Error(`${root} is inside a git repository`);
    const workdir = prepare(task, arm, run, root);
    const settingsPath = join(root, "settings.json");
    const plugin = deps.pluginFor(arm);
    const persist = task.followUp !== undefined;
    const invoke = (prompt: string, resume?: string): Invocation =>
      buildInvocation({
        run,
        arm,
        prompt,
        workdir,
        settingsPath,
        configDir: config.configDir,
        model: config.model,
        maxBudgetUsd: config.maxBudgetUsd,
        plugin,
        session: resume === undefined ? { persist } : { persist, resume },
      });
    const invocation = invoke(task.prompt(run.taskSeed));
    writeFileSync(settingsPath, `${JSON.stringify(invocation.settings, null, 2)}\n`);
    const { outcome, followUps } = await converse(deps, task, run, invocation, invoke);
    const log = readIfAny(join(workdir, ".finitemonkey", "log.jsonl"));
    const saved = join(config.outDir, "runs", run.id);
    mkdirSync(saved, { recursive: true });
    writeFileSync(join(saved, "transcript.jsonl"), outcome.stdout);
    writeFileSync(join(saved, "log.jsonl"), log);
    const scored = task.evaluate?.(workdir, run.taskSeed, outcome.stdout) ?? {};
    return { ...scored, ...record(config, deps, run, arm, outcome, log), followUps };
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM") throw error;
    }
  }
};

export const runBench = async (config: HarnessConfig, deps: HarnessDeps): Promise<readonly RunRecord[]> => {
  const records: RunRecord[] = [];
  mkdirSync(config.outDir, { recursive: true });
  for (const run of schedule(config)) {
    const task = config.tasks.find((item) => item.id === run.task);
    const arm = config.arms.find((item) => item.id === run.arm);
    if (task === undefined || arm === undefined) continue;
    const result = await runOne(config, deps, run, task, arm);
    appendFileSync(join(config.outDir, "runs.jsonl"), `${JSON.stringify(result)}\n`);
    records.push(result);
  }
  return records;
};
