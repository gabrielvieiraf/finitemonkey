import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluate, parseBudgets, summary } from "./budget-eval.js";
import { guardLatency, measureContext, withFixtureProject } from "./budget-measure.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const budgets = parseBudgets(readFileSync(join(root, "budgets.json"), "utf8"));
const contextOnly = process.argv.includes("--context");

const rows = await withFixtureProject(async (project) =>
  evaluate(
    budgets,
    await measureContext(project),
    contextOnly ? [] : await guardLatency(project, budgets.latency.runs),
  ),
);

const text = summary(rows);
console.log(text);
const target = process.env["GITHUB_STEP_SUMMARY"];
if (target !== undefined && target !== "") appendFileSync(target, `${text}\n`);

const over = rows.filter((row) => !row.ok);
for (const row of over) {
  console.error(
    row.ceiling === undefined
      ? `${row.name} has no ceiling in budgets.json`
      : `${row.name} is ${String(row.value)}, over its ceiling of ${String(row.ceiling)}`,
  );
}
if (over.length > 0) process.exit(1);
