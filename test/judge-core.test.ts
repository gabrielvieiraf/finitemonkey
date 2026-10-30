import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { catalogs } from "../src/i18n/catalogs.js";
import { COMMITTED_STATE } from "../src/install/layout.js";
import { countRule } from "../src/judge/band.js";
import { parseRequest } from "../src/judge/request.js";
import { appendEntry, readEntries } from "../src/judge/store.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { personWording } from "../src/judge/wording.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { compatProblems } from "./schema-compat.js";
import { fakeRuntime, ROOT } from "./support.js";

const root = toAbsolutePath("/home/ana/project");
const paths = fmPaths(root);

interface World {
  readonly fs: MemoryFs;
  readonly deps: JudgeDeps;
}

const world = (extra: Partial<JudgeDeps> = {}): World => {
  const fs = memoryFs({}, [toAbsolutePath("/home/ana/project/.finitemonkey")]);
  return { fs, deps: { runtime: fakeRuntime({ fs }), paths, ...extra } };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const concept = (deps: JudgeDeps, id: string, label: string): void => {
  const written = appendEntry(deps.runtime, deps.paths, {
    type: "concept",
    id,
    at: deps.runtime.now(),
    domain: "tax-law",
    label,
    synonyms: [],
    anchors: [],
    origin: "span",
  });
  assert.equal(written.ok, true);
};

const proof = (w: World, concepts: readonly string[], result: "pass" | "fail", kind = "prediction"): string => {
  w.fs.tick(1000);
  const id = `e-${String(Date.parse(w.deps.runtime.now()))}`;
  const written = appendEntry(w.deps.runtime, w.deps.paths, {
    type: "evidence",
    id,
    at: w.deps.runtime.now(),
    concepts,
    proof: kind,
    result,
    ref: `hash-${id}`,
    origin: "person",
  });
  assert.equal(written.ok, true);
  return id;
};

const bandOf = (deps: JudgeDeps, id: string): unknown => call(deps, { verb: "fade", concept: id }).concepts?.[0]?.band;

describe("judge core: invariants", () => {
  it("a request full of domain terms leaves every band unchanged", () => {
    const w = world();
    concept(w.deps, "vat", "VAT");
    concept(w.deps, "nexus", "economic nexus");
    for (let index = 0; index < 5; index += 1) {
      const observed = call(w.deps, { verb: "observe", concepts: ["vat", "nexus"], proof: "exposure" });
      assert.equal(observed.ok, true);
    }
    assert.equal(bandOf(w.deps, "vat"), "no record");
    assert.equal(bandOf(w.deps, "nexus"), "no record");
    const agentClaimsProof = call(w.deps, { verb: "observe", concepts: ["vat"], proof: "prediction", ref: "h1" });
    assert.equal(agentClaimsProof.ok, true);
    assert.equal(bandOf(w.deps, "vat"), "no record");
  });

  it("the store rejects a band written as a fact and evidence without a pointer", () => {
    const w = world();
    const at = w.deps.runtime.now();
    const band = appendEntry(w.deps.runtime, paths, {
      type: "band",
      id: "b1",
      at,
      concept: "vat",
      band: "demonstrated",
    });
    assert.deepEqual(band, { ok: false, reason: "band_derived" });
    const loose = appendEntry(w.deps.runtime, paths, {
      type: "evidence",
      id: "e1",
      at,
      concepts: ["vat"],
      proof: "probe",
      result: "pass",
      origin: "person",
    });
    assert.deepEqual(loose, { ok: false, reason: "no_pointer" });
    assert.equal(readEntries(w.deps.runtime, paths).length, 0);
  });

  it("every band change points to the evidence that caused it", () => {
    const w = world();
    concept(w.deps, "vat", "VAT");
    const ids = [proof(w, ["vat"], "pass"), proof(w, ["vat"], "pass"), proof(w, ["vat"], "pass")];
    const view = call(w.deps, { verb: "report" }).concepts?.find((item) => item.concept === "vat");
    assert.equal(view?.band, "demonstrated");
    assert.equal(view.because?.evidence, ids[2]);
    assert.equal(view.because?.proof, "prediction");
  });

  it("a fake model that says supported for every claim changes no support state", () => {
    const w = world({ proposer: () => "supported" });
    const classified = call(w.deps, {
      verb: "classify",
      file: "note.md",
      text: "The rate is 20%. The rule took effect in 2021.",
    });
    for (const row of classified.result?.rows ?? []) {
      const verified = call(w.deps, { verb: "verify", claim: row.claim });
      assert.equal(verified.claim?.state, "model-only");
      assert.equal(verified.claim.proposed, "supported");
    }
    const byModel = appendEntry(w.deps.runtime, paths, {
      type: "support",
      id: "s1",
      at: w.deps.runtime.now(),
      claim: classified.result?.rows[0]?.claim,
      state: "machine-verified",
      by: "model",
      ref: "x",
    });
    assert.deepEqual(byModel, { ok: false, reason: "not_a_decider" });
    assert.equal(call(w.deps, { verb: "classify", file: "note.md", text: "The rate is 20%." }).result?.done, false);
  });

  it("contest takes an entry out of the count until newer evidence arrives", () => {
    const w = world();
    concept(w.deps, "vat", "VAT");
    proof(w, ["vat"], "pass");
    proof(w, ["vat"], "pass");
    proof(w, ["vat"], "pass");
    const failure = proof(w, ["vat"], "fail", "failure-after-acceptance");
    assert.equal(bandOf(w.deps, "vat"), "proximal");
    w.fs.tick(1000);
    assert.equal(call(w.deps, { verb: "contest", target: failure }).ok, true);
    assert.equal(bandOf(w.deps, "vat"), "demonstrated");
    proof(w, ["vat"], "pass");
    assert.equal(bandOf(w.deps, "vat"), "proximal");
  });

  it("fade withdraws the request once demonstrated and restores it after a later failure", () => {
    const w = world();
    concept(w.deps, "vat", "VAT");
    const request = (): unknown => call(w.deps, { verb: "fade", concept: "vat" }).concepts?.[0]?.request;
    assert.equal(request(), "active");
    proof(w, ["vat"], "pass");
    proof(w, ["vat"], "pass");
    assert.equal(request(), "active");
    proof(w, ["vat"], "pass");
    assert.equal(request(), "withdrawn");
    proof(w, ["vat"], "fail", "failure-after-acceptance");
    assert.equal(request(), "active");
  });

  it("the count rule separates no record from beyond", () => {
    assert.equal(countRule([]), "no record");
    assert.equal(countRule([-1]), "beyond");
    assert.equal(countRule([1]), "proximal");
    assert.equal(countRule([1, 1, 1]), "demonstrated");
    assert.equal(countRule([1, 1, 1, -1]), "proximal");
  });

  it("forget and export cover every store, and none of it is committed", () => {
    const w = world();
    concept(w.deps, "vat", "VAT");
    const classified = call(w.deps, { verb: "classify", file: "n.md", text: "The rate is 20% since 2021." });
    const claim = classified.result?.rows[0]?.claim ?? "";
    call(w.deps, { verb: "handoff", claim, to: "tax advisor", missing: "the statute text" });
    const exported = call(w.deps, { verb: "export" }).export;
    assert.equal(exported?.concepts.length, 1);
    assert.equal(exported.claims.length, 1);
    assert.equal(exported.support.length, 1);
    call(w.deps, { verb: "forget" });
    const left = Object.keys(w.fs.files()).filter((path) => path.includes("/.finitemonkey/judge"));
    assert.deepEqual(left, []);
    assert.ok(!COMMITTED_STATE.some((path) => path.startsWith("judge")));
  });
});

describe("judge core: schema and wording", () => {
  it("no judge message describes the person", () => {
    for (const lang of ["en", "pt-BR", "es"] as const) assert.deepEqual(personWording(catalogs[lang]), []);
  });

  it("removing a field from the judge schema fails the compatibility test", () => {
    const frozen: unknown = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "schema", "judge@1.json"), "utf8"));
    const current: unknown = JSON.parse(readFileSync(join(ROOT, "docs", "schema", "judge@1.json"), "utf8"));
    assert.deepEqual(compatProblems(frozen, current), []);
    const text = JSON.stringify(current).replace('"evidence":{', '"evidenceGone":{');
    assert.notDeepEqual(compatProblems(frozen, JSON.parse(text)), []);
  });
});
