import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { GUARD_SETS } from "../src/hooks/handlers.js";
import { SAMPLES } from "../test/secret-samples.js";
import { measureContext, runtime, withFixtureProject } from "./budget-measure.js";
import { type CorpusCase, expandCase, loadCorpus } from "./evidence-corpus.js";
import {
  armOverhead,
  DEFAULT_GUARD_BUDGET,
  type Evidence,
  EVIDENCE_SCHEMA,
  type GuardEvidence,
  guardEvidence,
  judge,
  parseEvidenceBudgets,
  parseReviewEvidence,
  type ReviewEvidence,
} from "./evidence-rates.js";
import { prepareFixture, replayGuard } from "./evidence-replay.js";
import { EVIDENCE_FILE, renderEvidence } from "./evidence-text.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const fail = (message: string): never => {
  console.error(`evidence: ${message}`);
  process.exit(2);
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { runs: { type: "string" }, out: { type: "string" }, review: { type: "string" } },
  strict: true,
});

const budgetsFile = parseJsonObject(readFileSync(join(root, "budgets.json"), "utf8"));
if (!budgetsFile.ok) fail(budgetsFile.error);
const budgets = parseEvidenceBudgets(budgetsFile.ok ? budgetsFile.value["evidence"] : undefined);
if (!budgets.ok) fail(budgets.error);

const corpus = loadCorpus(join(root, "bench", "corpus"));
if (!corpus.ok) fail(corpus.error);

const samples: Readonly<Record<string, string>> = SAMPLES;
const expanded = (cases: readonly CorpusCase[]): readonly CorpusCase[] =>
  cases.map((item) => {
    const result = expandCase(item, samples);
    return result.ok ? result.value : fail(result.error);
  });

const runRecords = (path: string | undefined): readonly JsonObject[] => {
  if (path === undefined) return [];
  const file = existsSync(join(path, "runs.jsonl")) ? join(path, "runs.jsonl") : path;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const record = parseJsonObject(line);
      return record.ok ? [record.value] : [];
    });
};

const reviewScores = (path: string | undefined): ReviewEvidence | null => {
  if (path === undefined) return null;
  const raw = parseJsonObject(readFileSync(path, "utf8"));
  const parsed = raw.ok ? parseReviewEvidence(raw.value) : null;
  return parsed ?? fail(`${path} is not a bench:review score file`);
};

const alwaysOn = GUARD_SETS.filter((set) => set.damage);

const measured = await withFixtureProject(async (project) => {
  const fixture = await prepareFixture(runtime, project);
  try {
    const guards: GuardEvidence[] = [];
    for (const set of alwaysOn) {
      const handlers = set.handlers.PreToolUse ?? [];
      const cases = expanded((corpus.ok ? corpus.value[set.id] : undefined) ?? []);
      await replayGuard(runtime, project, handlers, cases);
      guards.push(guardEvidence(set.id, await replayGuard(runtime, project, handlers, cases)));
    }
    const context = await measureContext(project);
    return { guards, context };
  } finally {
    fixture.dispose();
  }
});

const pkg = parseJsonObject(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.ok && typeof pkg.value["version"] === "string" ? pkg.value["version"] : "unknown";

const evidence: Evidence = {
  schema: EVIDENCE_SCHEMA,
  version,
  budget: budgets.ok ? budgets.value.defaults : DEFAULT_GUARD_BUDGET,
  guards: measured.guards,
  contextBytes: Object.fromEntries(
    measured.context.filter((measure) => measure.name.endsWith("Bytes")).map((item) => [item.name, item.value]),
  ),
  arms: armOverhead(runRecords(values.runs)),
  review: reviewScores(values.review),
};

const out = values.out ?? join(root, EVIDENCE_FILE);
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);

const table = renderEvidence("en", evidence);
console.log(table);
const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary !== undefined && summary !== "") appendFileSync(summary, `${table}\n`);

const verdicts = budgets.ok ? evidence.guards.map((guard) => judge(guard, budgets.value)) : [];
for (const verdict of verdicts) {
  if (verdict.verdict === "ok") continue;
  const wrong = evidence.guards.find((guard) => guard.guard === verdict.guard)?.wrong ?? [];
  console.error(`${verdict.verdict}: ${verdict.guard}: ${verdict.reasons.join("; ")}`);
  if (wrong.length > 0) console.error(`  wrong decisions: ${wrong.join(", ")}`);
}
if (verdicts.some((verdict) => verdict.verdict === "fail")) process.exit(1);
