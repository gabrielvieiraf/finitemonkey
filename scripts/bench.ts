import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadArms, unpinned } from "./bench-arms.js";
import { realDeps } from "./bench-claude.js";
import {
  DEFAULT_MAX_BUDGET_USD,
  estimate,
  heldoutProblem,
  parseBenchArgs,
  pick,
  realRunProblems,
} from "./bench-cli.js";
import { loadFamilies, loadPersonas } from "./bench-family.js";
import { runBench, schedule } from "./bench-harness.js";
import { loadPhase, phaseEstimate, phaseProblems, phaseRuns } from "./bench-phase.js";
import { verifyFrozen } from "./bench-prereg.js";
import { suiteTasks } from "./bench-suite.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const benchDir = join(repo, "bench");

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const unwrap = <T>(
  parsed: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
) => (parsed.ok ? parsed.value : fail(parsed.error));

const args = unwrap(parseBenchArgs(process.argv.slice(2)));
const freeze = unwrap(verifyFrozen(benchDir));
const allArms = unwrap(loadArms(join(benchDir, "arms")));
const heldoutIssue = heldoutProblem(repo, args.heldout);
if (heldoutIssue !== undefined) fail(heldoutIssue);
const families = [
  ...unwrap(loadFamilies(join(benchDir, "tasks"), "public")),
  ...(args.heldout === undefined ? [] : unwrap(loadFamilies(args.heldout, "heldout"))),
];
const personas = unwrap(loadPersonas(join(benchDir, "personas")));
const allTasks = suiteTasks(families, personas);
const phase = args.phase === undefined ? undefined : unwrap(loadPhase(benchDir, args.phase));
if (phase !== undefined) {
  const problems = phaseProblems(phase, families, personas, allArms);
  if (problems.length > 0) fail(problems.join("\n"));
}
const maxBudgetUsd = args.maxBudgetUsd ?? phase?.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
const planned = phase === undefined ? undefined : phaseRuns(phase, args.seed);
const arms =
  phase === undefined
    ? unwrap(pick(allArms, args.arms, "arm"))
    : allArms.filter((arm) => phase.groups.some((group) => group.arms.includes(arm.id)));
const tasks =
  planned === undefined
    ? unwrap(pick(allTasks, args.tasks, "task"))
    : allTasks.filter((task) => planned.some((run) => run.task === task.id));
const runs = schedule({
  tasks,
  arms,
  repeats: args.repeats,
  seed: args.seed,
  ...(planned === undefined ? {} : { runs: planned }),
  ...(args.only ? { only: args.only } : {}),
});
const turnsOf = (task: string): number => {
  const persona = personas.find((item) => task.endsWith(`.${item.id}`));
  return 1 + (persona?.behavior.maxFollowUps ?? 0);
};

console.log(`preregistration ${freeze.sha256.slice(0, 12)} frozen ${freeze.frozenAt}`);
const phaseCost = phase === undefined ? undefined : phaseEstimate(phase, runs, arms, turnsOf, maxBudgetUsd);
if (phaseCost === undefined) {
  console.log(estimate(runs.length, maxBudgetUsd, Math.max(1, ...runs.map((run) => turnsOf(run.task)))));
} else {
  for (const line of phaseCost.lines) console.log(line);
}
for (const run of runs) console.log(`${String(run.order).padStart(3)} ${run.id} task seed ${String(run.taskSeed)}`);
if (args.dryRun) process.exit(0);

const problems = realRunProblems({
  yes: args.yes,
  tty: process.stdin.isTTY && process.stdout.isTTY,
  sessions: runs.length,
  unpinned: unpinned(arms.filter((arm) => runs.some((run) => run.arm === arm.id))),
  configDir: args.configDir,
  configHasInstructions: args.configDir !== undefined && existsSync(join(args.configDir, "CLAUDE.md")),
  ...(phaseCost !== undefined && !phaseCost.withinCap
    ? { overCap: `the worst case US$ ${phaseCost.worstUsd.toFixed(2)} is over the phase cap; lower --max-budget-usd` }
    : {}),
});
if (problems.length > 0) fail(problems.join("\n"));

const outDir =
  args.out ?? join(benchDir, "results", `${phase === undefined ? "" : `${phase.id}-`}seed-${String(args.seed)}`);
const records = await runBench(
  {
    outDir,
    seed: args.seed,
    repeats: args.repeats,
    model: args.model,
    maxBudgetUsd,
    configDir: args.configDir ?? "",
    freeze,
    tasks,
    arms,
    ...(planned === undefined || phase === undefined ? {} : { runs: planned, onboard: phase.onboard, phase: phase.id }),
    ...(args.only ? { only: args.only } : {}),
  },
  realDeps(repo, join(repo, "node_modules", ".cache", "fm-bench-arms")),
);
const broken = records.filter((record) => !record.injection.ok);
console.log(`${String(records.length)} runs written to ${outDir}`);
for (const record of broken) console.error(`${record.run}: ${record.injection.problems.join("; ")}`);
if (broken.length > 0) process.exit(1);
