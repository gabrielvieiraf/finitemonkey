import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { catalogs } from "../src/i18n/catalogs.js";
import { parseRequest } from "../src/judge/request.js";
import { appendEntry } from "../src/judge/store.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import type { Verifier } from "../src/judge/verify.js";
import { personWording } from "../src/judge/wording.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const paths = fmPaths(toAbsolutePath("/home/ana/project"));

interface World {
  readonly fs: MemoryFs;
  readonly deps: JudgeDeps;
}

const verifyFlat: Verifier = (claim) =>
  claim.text.includes("OSS")
    ? { verified: true, outcome: "verified", ref: "h-oss" }
    : { verified: false, outcome: "mismatch" };

const world = (extra: Partial<JudgeDeps> = {}): World => {
  const fs = memoryFs({}, [toAbsolutePath("/home/ana/project/.finitemonkey")]);
  return {
    fs,
    deps: { runtime: fakeRuntime({ fs }), paths, verifiers: { number: verifyFlat, prose: verifyFlat }, ...extra },
  };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const REPORT = [
  "# Selling digital services in the EU",
  "",
  "The VAT rate for e-books in Germany is 7% since 2020.",
  "Registration in the OSS scheme takes 10 working days.",
  "A seller can choose to report quarterly.",
  "It is a good idea to keep records.",
  "Sales grew because the threshold dropped to 10,000 euros.",
  "",
].join("\n");

const concept = (w: World, label: string): string => {
  const added = call(w.deps, { verb: "concept", label, domain: "tax-law", source: "10.1/x", span: `about ${label}` });
  return added.entry ?? "";
};

const evidence = (w: World, id: string, result: "pass" | "fail", proof = "prediction"): void => {
  w.fs.tick(1000);
  const at = w.deps.runtime.now();
  const record = {
    type: "evidence",
    id: `e-${at}`,
    at,
    concepts: [id],
    proof,
    result,
    ref: `r-${at}`,
    origin: "person",
  };
  assert.equal(appendEntry(w.deps.runtime, paths, record).ok, true);
};

const rowsOf = (response: ReturnType<typeof call>) => response.result?.rows ?? [];

describe("x-ray of a research result", () => {
  it("builds the claim × state × band grid with the worst cell first", () => {
    const w = world();
    const vat = concept(w, "VAT");
    const oss = concept(w, "OSS");
    evidence(w, vat, "fail", "failure-after-acceptance");
    for (let index = 0; index < 3; index += 1) evidence(w, oss, "pass");
    const first = call(w.deps, { verb: "classify", file: "report.md", text: REPORT });
    const ossClaim = rowsOf(first).find((row) => row.text.includes("OSS"));
    call(w.deps, { verb: "verify", claim: ossClaim?.claim });
    const grid = rowsOf(call(w.deps, { verb: "classify", file: "report.md", text: REPORT })).map((row) => [
      row.state,
      row.band,
      row.text.slice(0, 20),
    ]);
    assert.deepEqual(grid, [
      ["model-only", "beyond", "The VAT rate for e-b"],
      ["model-only", "no record", "Selling digital serv"],
      ["model-only", "no record", "Sales grew because t"],
      ["machine-verified", "demonstrated", "Registration in the "],
    ]);
  });

  it("lists only sentences with a number, date, proper noun, citation or causal relation", () => {
    const w = world();
    const texts = rowsOf(call(w.deps, { verb: "classify", file: "r.md", text: REPORT })).map((row) => row.text);
    assert.ok(!texts.includes("A seller can choose to report quarterly."));
    assert.ok(!texts.includes("It is a good idea to keep records."));
    assert.ok(texts.includes("Selling digital services in the EU"));
  });

  it("a splitter that merges or splits badly changes no support state", () => {
    const merging = world();
    const good = call(merging.deps, { verb: "classify", file: "a.md", text: REPORT });
    const oss = rowsOf(good).find((row) => row.text.includes("OSS"));
    call(merging.deps, { verb: "verify", claim: oss?.claim });
    const bad = { ...merging.deps, splitter: (text: string) => [text.replace(/\n+/g, " "), "OSS", "7%"] };
    const rows = rowsOf(call(bad, { verb: "classify", file: "b.md", text: REPORT }));
    assert.ok(rows.every((row) => row.state === "model-only"));
    const again = rowsOf(call(merging.deps, { verb: "classify", file: "a.md", text: REPORT }));
    assert.equal(again.find((row) => row.claim === oss?.claim)?.state, "machine-verified");
  });

  it("I judge this without a keyed answer leaves the claim model-only", () => {
    const w = world();
    const row = rowsOf(call(w.deps, { verb: "classify", file: "r.md", text: REPORT }))[0];
    const unkeyed = call(w.deps, { verb: "judge", claim: row?.claim });
    assert.equal(unkeyed.reason, "no_key");
    assert.equal(call(w.deps, { verb: "fade" }).ok, true);
    const states = rowsOf(call(w.deps, { verb: "classify", file: "r.md", text: REPORT }));
    assert.equal(states.find((item) => item.claim === row?.claim)?.state, "model-only");
  });

  it("a keyed answer makes the claim person-judged; a wrong one routes it and only shows the span", () => {
    const w = world();
    const rows = rowsOf(call(w.deps, { verb: "classify", file: "r.md", text: REPORT }));
    const keyFor = (claim: string, span: string): void => {
      const record = {
        type: "support",
        id: `s-${claim}`,
        at: w.deps.runtime.now(),
        claim,
        state: "model-only",
        by: "machine",
        outcome: "anchored",
        anchors: [{ kind: "span", ref: "10.1/vat", span, hash: "0123456789abcdef" }],
      };
      assert.equal(appendEntry(w.deps.runtime, paths, record).ok, true);
    };
    const [one, two] = [rows[0]?.claim ?? "", rows[1]?.claim ?? ""];
    keyFor(one, "the reduced rate of 7% applies to e-books");
    keyFor(two, "registration must be made before the first sale");
    const asked = call(w.deps, { verb: "judge", claim: one }).probe;
    const right = asked?.options.indexOf("the reduced rate of 7% applies to e-books") ?? -1;
    assert.equal(asked?.options.length, 2);
    assert.equal(call(w.deps, { verb: "answer", probe: asked.probe, choice: right }).probe?.correct, true);
    const wrongProbe = call(w.deps, { verb: "judge", claim: two }).probe;
    const wrongIndex = wrongProbe?.options.findIndex(
      (option) => option !== "registration must be made before the first sale",
    );
    const wrong = call(w.deps, { verb: "answer", probe: wrongProbe?.probe, choice: wrongIndex });
    assert.equal(wrong.route, "verify");
    assert.equal(wrong.probe?.span, "registration must be made before the first sale");
    const states = rowsOf(call(w.deps, { verb: "classify", file: "r.md", text: REPORT }));
    assert.equal(states.find((item) => item.claim === one)?.state, "person-judged");
    assert.equal(states.find((item) => item.claim === two)?.state, "model-only");
  });

  it("no row text addresses the person's ability", () => {
    for (const lang of ["en", "pt-BR", "es"] as const) assert.deepEqual(personWording(catalogs[lang]), []);
  });
});
