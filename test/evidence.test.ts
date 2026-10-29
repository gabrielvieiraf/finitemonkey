import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { type CorpusCase, expandCase, expandText, loadCorpus, parseCases } from "../scripts/evidence-corpus.js";
import {
  armOverhead,
  type CaseResult,
  DEFAULT_GUARD_BUDGET,
  EVIDENCE_SCHEMA,
  guardEvidence,
  judge,
  parseEvidence,
  parseEvidenceBudgets,
} from "../scripts/evidence-rates.js";
import { absoluteInput, replayGuard } from "../scripts/evidence-replay.js";
import { readEvidence, renderEvidence } from "../scripts/evidence-text.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { parseJsonObject } from "../src/core/parsed.js";
import { GUARD_SETS, type HookHandler } from "../src/hooks/handlers.js";
import { SAMPLES } from "./secret-samples.js";
import { ROOT } from "./support.js";

const line = (record: object): string => JSON.stringify(record);

const item = (id: string, expect: "block" | "allow", command = "ls"): CorpusCase => {
  const parsed = parseCases(line({ id, expect, tool: "Bash", input: { command } }), "g");
  assert.ok(parsed.ok);
  const [first] = parsed.value;
  assert.ok(first !== undefined);
  return first;
};

const result = (id: string, expect: "block" | "allow", blocked: boolean, ms = 1): CaseResult => ({
  item: item(id, expect),
  blocked,
  ms,
});

const budgetsFile = (): unknown => {
  const parsed = parseJsonObject(readFileSync(join(ROOT, "budgets.json"), "utf8"));
  assert.ok(parsed.ok);
  return parsed.value["evidence"];
};

describe("evidence corpus", () => {
  it("parses cases and rejects a bad expectation, a duplicate id and staged files it does not seed", () => {
    const good = parseCases(
      [
        line({ id: "a", expect: "block", tool: "Bash", input: { command: "x" } }),
        "",
        line({ id: "b", expect: "allow", tool: "Write", input: { file_path: "f" }, files: { f: "1" }, staged: ["f"] }),
      ].join("\n"),
      "g",
    );
    assert.ok(good.ok);
    assert.deepEqual(
      good.value.map((entry) => [entry.id, entry.expect, entry.origin]),
      [
        ["a", "block", "synthetic"],
        ["b", "allow", "synthetic"],
      ],
    );
    assert.equal(parseCases(line({ id: "a", expect: "maybe", tool: "Bash", input: {} }), "g").ok, false);
    const twice = line({ id: "a", expect: "block", tool: "Bash", input: {} });
    assert.equal(parseCases(`${twice}\n${twice}`, "g").ok, false);
    assert.equal(
      parseCases(line({ id: "a", expect: "block", tool: "Bash", input: {}, staged: ["nope"] }), "g").ok,
      false,
    );
  });

  it("fills secret samples at replay time and rejects an unknown sample", () => {
    const filled = expandText("KEY={{sample:npmToken}}", { npmToken: "value" });
    assert.deepEqual(filled, { ok: true, value: "KEY=value" });
    assert.equal(expandText("{{sample:nope}}", {}).ok, false);
  });

  it("resolves relative file paths against the project", () => {
    const root = toAbsolutePath(tmpdir());
    assert.equal(absoluteInput(root, { file_path: "src/a.ts" })["file_path"], join(root, "src/a.ts"));
    assert.equal(absoluteInput(root, { command: "ls" })["command"], "ls");
  });

  it("every always-on guard has a corpus within its budget, and every case expands", () => {
    const corpus = loadCorpus(join(ROOT, "bench", "corpus"));
    assert.ok(corpus.ok, corpus.ok ? "" : corpus.error);
    const budgets = parseEvidenceBudgets(budgetsFile());
    assert.ok(budgets.ok);
    for (const set of GUARD_SETS.filter((guard) => guard.damage)) {
      const cases = corpus.value[set.id] ?? [];
      const budget = { ...budgets.value.defaults, ...budgets.value.guards[set.id] };
      const positives = cases.filter((entry) => entry.expect === "block").length;
      assert.ok(positives >= budget.minPositives, `${set.id}: ${String(positives)} positives`);
      assert.ok(
        cases.length - positives >= budget.minNegatives,
        `${set.id}: ${String(cases.length - positives)} negatives`,
      );
      for (const entry of cases) assert.ok(expandCase(entry, SAMPLES).ok, `${set.id}/${entry.id}`);
    }
  });
});

describe("evidence rates", () => {
  it("counts false positives and negatives over the right denominators", () => {
    const evidence = guardEvidence("g", [
      result("p1", "block", true, 1),
      result("p2", "block", false, 2),
      result("n1", "allow", false, 3),
      result("n2", "allow", false, 4),
      result("n3", "allow", false, 5),
      result("n4", "allow", true, 100),
    ]);
    assert.deepEqual(
      [evidence.positives, evidence.negatives, evidence.falsePositives, evidence.falseNegatives],
      [2, 4, 1, 1],
    );
    assert.deepEqual([evidence.fpr, evidence.fnr, evidence.p50Ms, evidence.p95Ms], [0.25, 0.5, 3, 100]);
    assert.deepEqual(evidence.wrong, ["n4", "p2"]);
  });

  it("passes under the alert budget, warns between 5% and 15%, fails above 15% or on a thin corpus", () => {
    const budgets = parseEvidenceBudgets({ minPositives: 1, minNegatives: 10 });
    assert.ok(budgets.ok);
    const withFalsePositives = (count: number): CaseResult[] => [
      result("p", "block", true),
      ...Array.from({ length: 20 }, (_, index) => result(`n${String(index)}`, "allow", index < count)),
    ];
    assert.equal(judge(guardEvidence("g", withFalsePositives(1)), budgets.value).verdict, "ok");
    assert.equal(judge(guardEvidence("g", withFalsePositives(2)), budgets.value).verdict, "warn");
    assert.equal(judge(guardEvidence("g", withFalsePositives(4)), budgets.value).verdict, "fail");
    assert.equal(judge(guardEvidence("g", [result("p", "block", true)]), budgets.value).verdict, "fail");
  });

  it("reads per-guard overrides and rejects negative numbers", () => {
    const parsed = parseEvidenceBudgets({ fprFail: 0.2, guards: { git: { fprFail: 0.1 } } });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.defaults.fprFail, 0.2);
    assert.equal(parsed.value.defaults.minPositives, DEFAULT_GUARD_BUDGET.minPositives);
    assert.equal(parsed.value.guards["git"]?.fprFail, 0.1);
    assert.equal(parseEvidenceBudgets({ fprFail: -1 }).ok, false);
  });

  it("summarizes bench runs per arm: tokens, wall time, cost and false done", () => {
    const arms = armOverhead([
      { arm: "plain", inputTokens: 100, outputTokens: 50, durationMs: 1000, costUsd: 0.1, falseDone: true },
      { arm: "plain", inputTokens: 300, outputTokens: 50, durationMs: 3000, costUsd: 0.3, falseDone: false },
      { arm: "fm", inputTokens: 200, outputTokens: 100, durationMs: 2000, costUsd: null, falseDone: false },
    ]);
    assert.deepEqual(arms, [
      { arm: "fm", runs: 1, tokensMedian: 300, wallMsMedian: 2000, costUsdMedian: null, falseDoneRate: 0 },
      { arm: "plain", runs: 2, tokensMedian: 150, wallMsMedian: 1000, costUsdMedian: 0.1, falseDoneRate: 0.5 },
    ]);
  });
});

describe("evidence replay", () => {
  it("replays each case through the handlers, times it and puts seeded files back", async () => {
    const root = toAbsolutePath(realpathSync.native(mkdtempSync(join(tmpdir(), "fm-evidence-"))));
    try {
      writeFileSync(join(root, "kept.txt"), "before\n");
      const seen: string[] = [];
      const handler: HookHandler = ({ payload, runtime }) => {
        const input = payload.raw["tool_input"];
        const command = typeof input === "object" && input !== null && "command" in input ? input.command : "";
        seen.push(runtime.readText(toAbsolutePath(join(root, "kept.txt"))).ok ? "seeded" : "missing");
        return String(command).includes("bad") ? { kind: "block", reason: "no" } : { kind: "allow" };
      };
      const cases = [
        { ...item("a", "block", "bad thing"), files: { "kept.txt": "during\n", "new.txt": "x" } },
        item("b", "allow", "good thing"),
      ];
      const results = await replayGuard(nodeRuntime(), root, [handler], cases);
      assert.deepEqual(
        results.map((entry) => entry.blocked),
        [true, false],
      );
      assert.ok(results.every((entry) => entry.ms >= 0));
      assert.deepEqual(seen, ["seeded", "seeded"]);
      assert.equal(readFileSync(join(root, "kept.txt"), "utf8"), "before\n");
      assert.equal(existsSync(join(root, "new.txt")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("evidence file and README", () => {
  it("the committed evidence file parses and renders a table per language", () => {
    const evidence = readEvidence(ROOT);
    assert.ok(evidence !== undefined);
    for (const lang of ["en", "pt-BR", "es"] as const) {
      const text = renderEvidence(lang, evidence);
      for (const guard of evidence.guards) assert.match(text, new RegExp(`\\| \`${guard.guard}\` \\|`));
    }
  });

  it("without a measurement the README says so instead of showing numbers", () => {
    assert.equal(renderEvidence("en", undefined), "No measurement yet.");
    const parsed = parseEvidence({ schema: EVIDENCE_SCHEMA, version: "1.0.0", guards: [], arms: [] });
    assert.ok(parsed.ok);
    assert.equal(renderEvidence("es", parsed.value), "Todavía sin medición.");
    assert.equal(parseEvidence({ schema: "other", version: "1" }).ok, false);
  });
});
