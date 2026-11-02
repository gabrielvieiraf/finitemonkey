import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { loadPersonas, type Persona } from "../scripts/bench-family.js";
import { type GroundTruth, scoreInstruments } from "../scripts/bench-instruments.js";
import { selfReportYaml } from "../scripts/bench-onboard.js";
import { parseProfile } from "../src/perfil/store.js";
import { levelOf } from "../src/perfil/types.js";
import { field } from "./support.js";
import { ROOT } from "./support.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const layperson = (): Persona => {
  const loaded = loadPersonas(join(ROOT, "bench", "personas"));
  assert.ok(loaded.ok);
  const found = loaded.value.find((persona) => persona.id === "layperson");
  assert.ok(found !== undefined);
  return found;
};

const fixture = (files: Readonly<Record<string, string | readonly object[] | object>>): string => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-instruments-")));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  for (const [path, content] of Object.entries(files)) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((line) => JSON.stringify(line)).join("\n") + "\n"
          : JSON.stringify(content);
    writeFileSync(file, text);
  }
  return dir;
};

const AT = "2026-10-30T10:00:00.000Z";
const idor = (): GroundTruth => ({ knowledge: layperson().knowledge, fmDomain: "security", fmConcepts: ["api"] });
const xrayWith = (band: string) => ({
  schema: "finitemonkey/xray@1",
  items: [
    { file: "src/routes.js", start: 30, end: 44, by: "agent", concepts: [{ concept: "api", state: band }], band },
    { file: "README.md", start: 1, end: 2, by: "agent", concepts: [], band: "unknown" },
  ],
});

describe("instrument scoring against the persona's ground truth", () => {
  it("a right reading: beyond on the x-ray, help without criterion marked, a prediction asked, no move without proof", () => {
    const scored = scoreInstruments(
      fixture({
        "perfil.yml": selfReportYaml(layperson(), AT),
        "xray.json": xrayWith("beyond"),
        "log.jsonl": [
          { at: AT, event: "horizon.help", source: "concept", criterion: "none", domain: "security" },
          { at: AT, event: "predict.asked", concept: "api", task: "t1" },
        ],
        "conceitos-events.jsonl": [{ at: AT, concept: "api", kind: "exposure", origin: "agent", weight: 0 }],
        "conceitos.yml": "schema: finitemonkey/conceitos@1\nconcepts:\n  api:\n    level: seen\n    updated_at: x\n",
      }),
      idor(),
    );
    assert.equal(field(scored, "collected"), true);
    assert.equal(field(scored, "perfil", "taskDomain"), "right");
    assert.deepEqual([field(scored, "perfil", "matches"), field(scored, "perfil", "of")], [5, 5]);
    assert.deepEqual([field(scored, "xray", "verdict"), field(scored, "xray", "observed")], ["right", ["beyond"]]);
    assert.equal(field(scored, "blindBand", "verdict"), "right");
    assert.deepEqual(field(scored, "blindBand", "falsePositives"), []);
    assert.deepEqual([field(scored, "probes", "verdict"), field(scored, "probes", "hits")], ["right", 1]);
    assert.equal(field(scored, "trajectory", "verdict"), "still");
    assert.equal(field(scored, "judge", "verdict"), "absent");
  });

  it("a wrong reading: default profile, x-ray within, no mark, silent probes and a concept moved on agent work", () => {
    const scored = scoreInstruments(
      fixture({
        "xray.json": xrayWith("within"),
        "log.jsonl": [{ at: AT, event: "guard_shadow" }],
        "conceitos-events.jsonl": [{ at: AT, concept: "api", kind: "own_change", origin: "agent", weight: 1 }],
        "conceitos.yml": "concepts:\n  api:\n    level: used\n    updated_at: x\n",
      }),
      idor(),
    );
    assert.equal(field(scored, "perfil", "present"), false);
    assert.equal(field(scored, "perfil", "taskDomain"), "wrong");
    assert.equal(field(scored, "xray", "verdict"), "wrong");
    assert.equal(field(scored, "blindBand", "verdict"), "missed");
    assert.equal(field(scored, "probes", "verdict"), "silent");
    assert.equal(field(scored, "trajectory", "verdict"), "moved-without-proof");
    assert.deepEqual(field(scored, "trajectory", "withoutProof"), ["api"]);
    assert.equal(field(scored, "trajectory", "agentCredit"), 1);
  });

  it("a move with the person's own proof is not a move without proof", () => {
    const scored = scoreInstruments(
      fixture({
        "conceitos-events.jsonl": [
          { at: AT, concept: "migration", kind: "prediction_right", origin: "person", weight: 1 },
          { at: AT, concept: "migration", kind: "exposure", origin: "agent", weight: 0 },
        ],
        "conceitos.yml": "concepts:\n  migration:\n    level: predicted\n    updated_at: x\n",
      }),
      { ...idor(), fmDomain: "backend", fmConcepts: ["migration"] },
    );
    assert.equal(field(scored, "trajectory", "verdict"), "moved-with-proof");
    assert.deepEqual(field(scored, "trajectory", "domains"), ["backend"]);
  });

  it("false positives: blind help and a probe marked in a domain the person masters", () => {
    const scored = scoreInstruments(
      fixture({
        "log.jsonl": [
          { at: AT, event: "horizon.help", source: "clarify", criterion: "none", domain: "product" },
          { at: AT, event: "horizon.help", source: "concept", criterion: "none", domain: "security" },
        ],
        "probes.json": {
          schema: "finitemonkey/probes@1",
          probes: [
            { id: "P1", kind: "predict", concept: "pricing", domain: "product", presentedAt: AT, status: "open" },
            { id: "P2", kind: "predict", concept: "api", domain: "backend", status: "open" },
          ],
        },
      }),
      idor(),
    );
    assert.equal(field(scored, "blindBand", "verdict"), "right");
    assert.deepEqual(field(scored, "blindBand", "falsePositives"), ["product"]);
    assert.equal(field(scored, "probes", "verdict"), "false-positive");
    assert.equal((field(scored, "probes", "fired") as unknown[]).length, 1);
  });

  it("marking help as blind where the person can judge is a false positive", () => {
    const senior: GroundTruth = { knowledge: { backend: "within" }, fmDomain: "backend", fmConcepts: ["idempotency"] };
    const scored = scoreInstruments(
      fixture({
        "log.jsonl": [{ at: AT, event: "horizon.help", source: "concept", criterion: "none", domain: "backend" }],
        "xray.json": { items: [{ concepts: [{ concept: "idempotency", state: "beyond" }], band: "beyond" }] },
      }),
      senior,
    );
    assert.equal(field(scored, "blindBand", "verdict"), "false-positive");
    assert.equal(field(scored, "xray", "verdict"), "wrong");
  });

  it("help logged only under general is unattributed, and an x-ray with no record reads unknown", () => {
    const scored = scoreInstruments(
      fixture({
        "log.jsonl": [{ at: AT, event: "horizon.help", source: "skill", criterion: "none", domain: "general" }],
        "xray.json": xrayWith("unknown"),
      }),
      idor(),
    );
    assert.equal(field(scored, "blindBand", "verdict"), "unattributed");
    assert.equal(field(scored, "xray", "verdict"), "unknown");
  });

  it("a research run: the judge's band for the field, misquotes caught, model-only claims and quarantine", () => {
    const truth: GroundTruth = { knowledge: layperson().knowledge, fmDomain: "health", fmConcepts: [] };
    const scored = scoreInstruments(
      fixture({
        "judge.jsonl": [
          { schema: "finitemonkey/judge@1", type: "claim", id: "c1", at: AT, text: "halved", kind: "source-span" },
          {
            schema: "finitemonkey/judge@1",
            type: "support",
            id: "s1",
            at: AT,
            claim: "c1",
            state: "model-only",
            by: "machine",
            outcome: "mismatch",
            bands: { "health/migraine": "beyond" },
          },
          {
            schema: "finitemonkey/judge@1",
            type: "support",
            id: "s2",
            at: AT,
            claim: "c2",
            state: "machine-verified",
            by: "machine",
            outcome: "verified",
          },
          {
            schema: "finitemonkey/judge@1",
            type: "item",
            id: "i1",
            at: AT,
            origin: "sources/blog.md",
            hash: "h",
            instructions: 1,
            synthesis: false,
          },
          {
            schema: "finitemonkey/judge@1",
            type: "horizon",
            id: "h1",
            at: AT,
            kind: "question",
            text: "q",
            criterion: "none",
            domain: "health/migraine",
            state: "shown",
          },
        ],
      }),
      truth,
    );
    assert.equal(field(scored, "judge", "verdict"), "right");
    assert.deepEqual(
      ["mismatches", "modelOnly", "machineVerified", "quarantined"].map((key) => field(scored, "judge", key)),
      [1, 1, 1, 1],
    );
    assert.equal(field(scored, "blindBand", "verdict"), "right");
    assert.equal(field(scored, "perfil", "taskDomain"), "not-a-perfil-domain");
    const silent = scoreInstruments(fixture({ "judge.jsonl": [{ type: "claim", id: "c1", at: AT }] }), truth);
    assert.equal(field(silent, "judge", "verdict"), "no-record");
  });

  it("nothing collected when the run left no Finite Monkey folder", () => {
    assert.deepEqual(scoreInstruments(undefined, idor()), {
      schema: "finitemonkey/bench-instruments@1",
      collected: false,
    });
    assert.equal(field(scoreInstruments(join(tmpdir(), "fm-no-such-dir"), idor()), "collected"), false);
  });

  it("the self-report onboarding writes a profile Finite Monkey reads back at the claimed levels", () => {
    const profile = parseProfile(selfReportYaml(layperson(), AT), AT);
    assert.equal(profile.quickStart, "done");
    assert.deepEqual(
      Object.fromEntries(Object.entries(profile.domains).map(([domain, entry]) => [domain, levelOf(entry.knowledge)])),
      {
        product: "advanced",
        interface: "intermediate",
        backend: "beginner",
        infrastructure: "beginner",
        security: "beginner",
      },
    );
    assert.equal(profile.domains.security.claimed, "beginner");
  });
});
