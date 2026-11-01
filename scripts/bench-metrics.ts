import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { loadFamilies } from "./bench-family.js";
import { computeMetrics, renderMetrics } from "./bench-metrics-lib.js";
import { loadRuns } from "./bench-metrics-read.js";

const USAGE = [
  "npm run bench:metrics -- --runs <bench output dir> [--json] [--out metrics.json]",
  "  computes every pending benchmark measure from runs.jsonl and the per-run logs, with n and the source file,",
  "  and names the measures that cannot be computed from local files",
].join("\n");

const repo = fileURLToPath(new URL("..", import.meta.url));

const fail = (message: string): never => {
  console.error(`bench:metrics: ${message}\n\n${USAGE}`);
  process.exit(2);
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { runs: { type: "string" }, json: { type: "boolean" }, out: { type: "string" } },
  strict: true,
});

const runsDir = values.runs ?? fail("--runs is required");
const runs = loadRuns(runsDir);
const families = loadFamilies(join(repo, "bench", "tasks"), "public");
if (!runs.ok) fail(runs.error);
if (!families.ok) fail(families.error);
const sizes = Object.fromEntries((families.ok ? families.value : []).map((family) => [family.id, family.size]));
const report = computeMetrics(runsDir, { runs: runs.ok ? runs.value : [], sizes });
const json = `${JSON.stringify(report, null, 2)}\n`;
if (values.out !== undefined) writeFileSync(values.out, json);
console.log(values.json === true ? json.trimEnd() : renderMetrics(report));
