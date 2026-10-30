import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parseJsonObject } from "../src/core/parsed.js";
import { agreement, parseLabel, sheetRows } from "./bench-agreement-lib.js";
import { loadPersonas } from "./bench-family.js";

const repo = fileURLToPath(new URL("..", import.meta.url));

const USAGE = [
  "npm run bench:agreement -- sheet --runs <bench output dir> --out <labels.jsonl>",
  "  writes one row per assistant turn with human: null, for people outside development to fill in",
  "npm run bench:agreement -- score --labels <labels.jsonl>",
  "  agreement and Cohen's kappa between the simulator's reaction and the person's, per persona and overall",
].join("\n");

const fail = (message: string): never => {
  console.error(`bench:agreement: ${message}\n\n${USAGE}`);
  process.exit(2);
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { runs: { type: "string" }, out: { type: "string" }, labels: { type: "string" } },
});

const lines = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const parsed = parseJsonObject(line);
      return parsed.ok ? [parsed.value] : [];
    });

const loaded = loadPersonas(join(repo, "bench", "personas"));
const personas = loaded.ok ? loaded.value : fail(loaded.error);
const step: string = positionals[0] ?? "";

switch (step) {
  case "sheet": {
    const runs = values.runs ?? fail("--runs is required");
    const out = values.out ?? fail("--out is required");
    const transcript = (run: string): string => {
      const file = join(runs, "runs", run, "transcript.jsonl");
      return existsSync(file) ? readFileSync(file, "utf8") : "";
    };
    const rows = sheetRows(lines(join(runs, "runs.jsonl")), transcript);
    writeFileSync(out, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
    console.log(`${String(rows.length)} rows written to ${out}`);
    break;
  }
  case "score": {
    const labels = lines(values.labels ?? fail("--labels is required")).flatMap((raw) => {
      const label = parseLabel(raw);
      return label === undefined ? [] : [label];
    });
    console.log("| Persona | n | Agree | Percent | Kappa |");
    console.log("|---|---|---|---|---|");
    for (const row of agreement(personas, labels)) {
      const kappa = row.kappa === null ? "-" : row.kappa.toFixed(2);
      console.log(
        `| ${row.persona} | ${String(row.n)} | ${String(row.agree)} | ${(row.percent * 100).toFixed(1)}% | ${kappa} |`,
      );
    }
    break;
  }
  default:
    fail(`unknown step ${step || "(none)"}`);
}
