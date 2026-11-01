import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  GUARDIAN_RESULTS,
  guardianEvidence,
  harmfulRedirectReasons,
  parseGuardianEvidence,
} from "../scripts/evidence-guardian.js";
import { EVIDENCE_SCHEMA, judge, parseEvidence, parseEvidenceBudgets } from "../scripts/evidence-rates.js";
import { renderEvidence } from "../scripts/evidence-text.js";
import { parseJsonObject } from "../src/core/parsed.js";
import { ROOT } from "./support.js";

const committed = () => {
  const raw = parseJsonObject(readFileSync(join(ROOT, GUARDIAN_RESULTS), "utf8"));
  assert.ok(raw.ok);
  const parsed = guardianEvidence(raw.value, GUARDIAN_RESULTS);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  return parsed.value;
};

const budgets = () => {
  const file = parseJsonObject(readFileSync(join(ROOT, "budgets.json"), "utf8"));
  assert.ok(file.ok);
  const parsed = parseEvidenceBudgets(file.value["evidence"]);
  assert.ok(parsed.ok);
  return parsed.value;
};

const scenario = (id: string, expected: number, observed: number) => ({ id, expected, observed });

const persona = (harmfulRedirects: number) => ({
  alertPrecision: 1,
  unnecessaryAlerts: 0,
  missed: 0,
  harmfulRedirects,
  acceptanceRate: null,
});

describe("guardian results in the evidence file", () => {
  it("counts alerts on the committed scenarios the way the guard rates count blocks", () => {
    const evidence = committed();
    assert.equal(evidence.scenarios, evidence.positives + evidence.negatives);
    assert.equal(evidence.source, GUARDIAN_RESULTS);
    assert.ok(evidence.personas.length > 0);
  });

  it("scores false positives and negatives against the expected level", () => {
    const parsed = guardianEvidence(
      {
        schema: "finitemonkey/guardian-bench@1",
        scenarios: [scenario("a", 2, 2), scenario("b", 1, 0), scenario("c", 0, 1), scenario("d", 0, 0)],
        personas: { beginner: persona(0) },
      },
      "x.json",
    );
    assert.ok(parsed.ok);
    assert.deepEqual(
      [parsed.value.falsePositives, parsed.value.falseNegatives, parsed.value.levelMatches, parsed.value.fpr],
      [1, 1, 2, 0.5],
    );
  });

  it("rejects a results file with another schema or malformed scenarios", () => {
    assert.equal(guardianEvidence({ schema: "other", scenarios: [] }, "x").ok, false);
    const bad = { schema: "finitemonkey/guardian-bench@1", scenarios: [{ id: "a" }], personas: {} };
    assert.equal(guardianEvidence(bad, "x").ok, false);
  });

  it("passes the committed scenarios through the budget check and fails when they shrink", () => {
    const evidence = committed();
    assert.equal(judge(evidence, budgets()).verdict, "ok");
    assert.equal(judge({ ...evidence, positives: evidence.positives - 1 }, budgets()).verdict, "fail");
    assert.equal(judge({ ...evidence, fpr: 0.5 }, budgets()).verdict, "fail");
  });

  it("names a harmful redirect as a failure reason", () => {
    const evidence = committed();
    assert.deepEqual(harmfulRedirectReasons(evidence), []);
    const harmed = { ...evidence, personas: [{ persona: "senior", ...persona(2) }] };
    assert.deepEqual(harmfulRedirectReasons(harmed), ["2 harmful redirects for the senior persona"]);
  });

  it("round-trips through evidence.json and renders a guardian row in every language", () => {
    const evidence = committed();
    const parsed = parseEvidence({
      schema: EVIDENCE_SCHEMA,
      version: "1.0.0",
      guards: [
        {
          guard: "secrets",
          n: 2,
          positives: 1,
          negatives: 1,
          falsePositives: 0,
          falseNegatives: 0,
          fpr: 0,
          fnr: 0,
          p50Ms: 1,
          p95Ms: 1,
        },
      ],
      arms: [],
      guardian: evidence,
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.guardian, evidence);
    for (const lang of ["en", "pt-BR", "es"] as const) {
      assert.match(renderEvidence(lang, parsed.value), new RegExp(`\\| ${String(evidence.scenarios)} \\|`));
    }
    assert.equal(parseGuardianEvidence({ guard: "other" }), null);
    assert.equal(parseEvidence({ schema: EVIDENCE_SCHEMA, version: "1", guards: [], arms: [] }).ok, true);
  });
});
