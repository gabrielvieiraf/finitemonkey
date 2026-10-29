import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadArms, unpinned } from "./bench-arms.js";
import { realDeps } from "./bench-claude.js";
import { estimate, heldoutProblem, parseBenchArgs, pick, realRunProblems } from "./bench-cli.js";
import { loadFamilies, loadPersonas } from "./bench-family.js";
import { runBench, schedule } from "./bench-harness.js";
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
const arms = unwrap(pick(unwrap(loadArms(join(benchDir, "arms"))), args.arms, "arm"));
const heldoutIssue = heldoutProblem(repo, args.heldout);
if (heldoutIssue !== undefined) fail(heldoutIssue);
const families = [
  ...unwrap(loadFamilies(join(benchDir, "tasks"), "public")),
  ...(args.heldout === undefined ? [] : unwrap(loadFamilies(args.heldout, "heldout"))),
];
const personas = unwrap(loadPersonas(join(benchDir, "personas")));
const tasks = unwrap(pick(suiteTasks(families, personas), args.tasks, "task"));
const runs = schedule({
  tasks,
  arms,
  repeats: args.repeats,
  seed: args.seed,
  ...(args.only ? { only: args.only } : {}),
});

console.log(`preregistration ${freeze.sha256.slice(0, 12)} frozen ${freeze.frozenAt}`);
console.log(
  estimate(
    runs.length,
    args.maxBudgetUsd,
    1 + Math.max(0, ...personas.map((persona) => persona.behavior.maxFollowUps)),
  ),
);
for (const run of runs) console.log(`${String(run.order).padStart(3)} ${run.id} task seed ${String(run.taskSeed)}`);
if (args.dryRun) process.exit(0);

const problems = realRunProblems({
  yes: args.yes,
  tty: process.stdin.isTTY && process.stdout.isTTY,
  sessions: runs.length,
  unpinned: unpinned(arms.filter((arm) => runs.some((run) => run.arm === arm.id))),
  configDir: args.configDir,
  configHasInstructions: args.configDir !== undefined && existsSync(join(args.configDir, "CLAUDE.md")),
});
if (problems.length > 0) fail(problems.join("\n"));

const outDir = args.out ?? join(benchDir, "results", `seed-${String(args.seed)}`);
const records = await runBench(
  {
    outDir,
    seed: args.seed,
    repeats: args.repeats,
    model: args.model,
    maxBudgetUsd: args.maxBudgetUsd,
    configDir: args.configDir ?? "",
    freeze,
    tasks,
    arms,
    ...(args.only ? { only: args.only } : {}),
  },
  realDeps(repo, join(repo, "node_modules", ".cache", "fm-bench-arms")),
);
const broken = records.filter((record) => !record.injection.ok);
console.log(`${String(records.length)} runs written to ${outDir}`);
for (const record of broken) console.error(`${record.run}: ${record.injection.problems.join("; ")}`);
if (broken.length > 0) process.exit(1);
