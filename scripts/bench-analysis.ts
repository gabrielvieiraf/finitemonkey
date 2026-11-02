import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { report } from "./bench-analysis-lib.js";
import { jsonLines } from "./bench-transcript.js";

const USAGE = [
  "npm run bench:analysis -- --runs <bench output dir> [--phase main] [--out report.md]",
  "  tables per family and arm (finished, false done, unsafe, trap named, cost, time)",
  "  and how well Finite Monkey read the simulated person, against the persona's ground truth",
].join("\n");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { runs: { type: "string" }, phase: { type: "string" }, out: { type: "string" } },
  strict: true,
});

const file = values.runs === undefined ? undefined : join(values.runs, "runs.jsonl");
if (file === undefined || !existsSync(file)) {
  console.error(`bench:analysis: --runs must be a folder with runs.jsonl\n\n${USAGE}`);
  process.exit(2);
}
const text = report(jsonLines(readFileSync(file, "utf8")), values.phase);
if (values.out === undefined) console.log(text);
else writeFileSync(values.out, text);
