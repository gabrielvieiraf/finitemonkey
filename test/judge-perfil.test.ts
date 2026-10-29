import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { parseRequest } from "../src/judge/request.js";
import { appendEntry } from "../src/judge/store.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const paths = fmPaths(toAbsolutePath("/home/ana/project"));

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

const SPAN = "A distance seller must charge the VAT rate of the customer's member state.";

const saveConcept = (w: World, label: string, domain = "tax-law"): string => {
  const added = call(w.deps, { verb: "concept", label, domain, source: "10.1000/vat-guide", span: SPAN });
  assert.equal(added.ok, true);
  return added.entry ?? "";
};

const keyed = (w: World, concept: string, result: "pass" | "fail", proof = "probe"): string => {
  w.fs.tick(1000);
  const id = `e-${String(Date.parse(w.deps.runtime.now()))}`;
  const at = w.deps.runtime.now();
  const record = { type: "evidence", id, at, concepts: [concept], proof, result, ref: `span-${id}`, origin: "person" };
  assert.equal(appendEntry(w.deps.runtime, paths, record).ok, true);
  return id;
};

const conceptOf = (w: World, id: string) => call(w.deps, { verb: "fade", concept: id }).concepts?.[0];

const domainOf = (w: World, id: string) => call(w.deps, { verb: "report" }).domains?.find((item) => item.domain === id);

describe("concept book for any field", () => {
  it("a request full of terms from a new field leaves every band unchanged", () => {
    const w = world({
      suggester: () => [
        { label: "reverse charge", domain: "tax-law" },
        { label: "place of supply", domain: "tax-law" },
      ],
    });
    const vat = saveConcept(w, "VAT");
    call(w.deps, {
      verb: "observe",
      text: "Explain VAT, the reverse charge, place of supply rules and OSS registration for EU digital services",
    });
    assert.equal(conceptOf(w, vat)?.band, "no record");
    const report = call(w.deps, { verb: "report" });
    for (const concept of report.concepts ?? []) assert.equal(concept.band, "no record");
    assert.equal(domainOf(w, "tax-law")?.band, "no record");
  });

  it("a span concept carries its anchor hash; a model suggestion stays suggested until evidence uses it", () => {
    const w = world({ suggester: () => [{ label: "reverse charge", domain: "tax-law" }] });
    saveConcept(w, "VAT");
    call(w.deps, { verb: "observe", text: "what is the reverse charge" });
    const exported = call(w.deps, { verb: "export" }).export;
    const vat = exported?.concepts.find((item) => item.label === "VAT");
    assert.equal(vat?.origin, "span");
    assert.match(vat.anchors[0]?.hash ?? "", /^[0-9a-f]{16}$/);
    assert.equal(vat.anchors[0]?.span, SPAN);
    const suggested = exported?.concepts.find((item) => item.label === "reverse charge");
    assert.equal(suggested?.origin, "model");
    assert.equal(conceptOf(w, suggested.id)?.status, "suggested");
    keyed(w, suggested.id, "pass");
    assert.equal(conceptOf(w, suggested.id)?.status, "active");
  });

  it("three keyed proofs demonstrate a concept; a failure after acceptance moves it back with the pointer", () => {
    const w = world();
    const vat = saveConcept(w, "VAT");
    keyed(w, vat, "pass");
    keyed(w, vat, "pass", "source-check");
    const third = keyed(w, vat, "pass", "prediction");
    assert.equal(conceptOf(w, vat)?.band, "demonstrated");
    assert.equal(conceptOf(w, vat)?.because?.evidence, third);
    const failure = keyed(w, vat, "fail", "failure-after-acceptance");
    const after = conceptOf(w, vat);
    assert.equal(after?.band, "proximal");
    assert.equal(after.because?.evidence, failure);
    assert.equal(after.because.proof, "failure-after-acceptance");
  });

  it("a domain with no evidence shows no record, distinct from beyond", () => {
    const w = world();
    call(w.deps, { verb: "domain", domain: "statistics" });
    call(w.deps, { verb: "domain", domain: "statistics/inference", parent: "statistics" });
    const pvalue = saveConcept(w, "p-value", "statistics/inference");
    saveConcept(w, "VAT");
    assert.equal(domainOf(w, "tax-law")?.band, "no record");
    keyed(w, pvalue, "fail", "failure-after-acceptance");
    assert.equal(domainOf(w, "statistics/inference")?.band, "beyond");
    assert.equal(domainOf(w, "statistics")?.band, "beyond");
    assert.equal(domainOf(w, "tax-law")?.band, "no record");
  });

  it("contest removes the contested entry from the count until newer evidence", () => {
    const w = world();
    const vat = saveConcept(w, "VAT");
    const wrong = keyed(w, vat, "fail", "failure-after-acceptance");
    assert.equal(conceptOf(w, vat)?.band, "beyond");
    w.fs.tick(1000);
    call(w.deps, { verb: "contest", target: wrong, reason: "the source was misread" });
    assert.equal(conceptOf(w, vat)?.band, "no record");
    assert.deepEqual(conceptOf(w, vat)?.contested, [wrong]);
    keyed(w, vat, "pass");
    assert.deepEqual(conceptOf(w, vat)?.contested, []);
  });
});
