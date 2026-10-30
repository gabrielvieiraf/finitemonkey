import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { createTranslator } from "../src/i18n/translate.js";
import type { Fetched } from "../src/judge/fetch.js";
import { judgeLines } from "../src/judge/lines.js";
import { parseRequest } from "../src/judge/request.js";
import { contentHash } from "../src/judge/span.js";
import { appendEntry } from "../src/judge/store.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const SOURCE = [
  "<p>Distance sellers must apply the VAT rate of the customer's member state.</p>",
  "<p>The threshold for distance sales is 10,000 euros across the union.</p>",
  "<p>Registration in the one-stop shop is optional for sellers below it.</p>",
].join("\n");

const SPAN = "Distance sellers must apply the VAT rate of the customer's member state";

interface World {
  readonly fs: MemoryFs;
  readonly deps: JudgeDeps;
}

const world = (extra: Partial<JudgeDeps> = {}): World => {
  const fs = memoryFs({}, [toAbsolutePath("/home/ana/project/.finitemonkey")]);
  const deps: JudgeDeps = {
    runtime: fakeRuntime({ fs }),
    paths: fmPaths(toAbsolutePath("/home/ana/project")),
    fetcher: (id): Fetched => (id === "10.1000/vat" ? { status: "ok", content: SOURCE } : { status: "not-found" }),
    ...extra,
  };
  return { fs, deps };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const keyedClaim = (w: World, text: string, span = SPAN): string => {
  const claim = call(w.deps, { verb: "classify", file: `${text.slice(0, 8)}.md`, text }).result?.rows[0]?.claim ?? "";
  const record = {
    type: "support",
    id: `s-${claim}`,
    at: w.deps.runtime.now(),
    claim,
    state: "model-only",
    by: "machine",
    outcome: "anchored",
    anchors: [{ kind: "span", ref: "10.1000/vat", span, hash: contentHash(SOURCE) }],
  };
  assert.equal(appendEntry(w.deps.runtime, w.deps.paths, record).ok, true);
  return claim;
};

const vatConcept = (w: World): string =>
  call(w.deps, { verb: "concept", label: "VAT", domain: "tax-law", source: "10.1000/vat", span: SPAN }).entry ?? "";

describe("probes keyed to the source, used to route verification", () => {
  it("no probe fires without a pending decision on a claim with no record or beyond", () => {
    const w = world();
    const vat = vatConcept(w);
    const claim = keyedClaim(w, "Sellers apply the customer's VAT rate (Directive 2017/2455).");
    assert.equal(parseRequest({ verb: "probe", claim }), undefined);
    for (let index = 0; index < 3; index += 1) {
      w.fs.tick(1000);
      const at = w.deps.runtime.now();
      const record = {
        type: "evidence",
        id: `e${String(index)}`,
        at,
        concepts: [vat],
        proof: "prediction",
        result: "pass",
        ref: `r${String(index)}`,
        origin: "person",
      };
      appendEntry(w.deps.runtime, w.deps.paths, record);
    }
    assert.equal(call(w.deps, { verb: "probe", claim, decision: "d1" }).reason, "no_trigger");
  });

  it("every probe has an answer key that is a span with a content hash", () => {
    const w = world();
    vatConcept(w);
    const prose = keyedClaim(w, "Sellers apply the customer's VAT rate (Directive 2017/2455).");
    const asked = call(w.deps, { verb: "probe", claim: prose, decision: "d1", session: "s1" }).probe;
    assert.equal(asked?.form, "unsupported-claim");
    assert.equal(asked.options.length, 3);
    const stored = call(w.deps, { verb: "export" }).export?.probes.at(-1);
    assert.equal(stored?.keyHash, contentHash(SOURCE));
    assert.ok(!SOURCE.includes(stored.options[stored.key] ?? "x"));
  });

  it("a fake model that labels the wrong option as correct does not change the recorded result", () => {
    const w = world({ distractors: () => [SPAN, "The threshold for distance sales is 10,000 euros across the union"] });
    vatConcept(w);
    const claim = keyedClaim(w, "Sellers apply the customer's VAT rate (Directive 2017/2455).");
    const asked = call(w.deps, { verb: "probe", claim, decision: "d1" }).probe;
    const modelPick = asked?.options.indexOf(SPAN) ?? -1;
    const answered = call(w.deps, { verb: "answer", probe: asked?.probe, choice: modelPick });
    assert.equal(answered.probe?.correct, false);
    const evidence = call(w.deps, { verb: "export" }).export?.evidence ?? [];
    assert.deepEqual(evidence, []);
  });

  it("a wrong answer routes the claim and shows only the source span", () => {
    const w = world();
    vatConcept(w);
    const claim = keyedClaim(w, "Sellers apply the customer's VAT rate (Directive 2017/2455).");
    const asked = call(w.deps, { verb: "probe", claim, decision: "d1" }).probe;
    const wrong = asked?.options.findIndex((_option, index) => index !== 0) ?? 1;
    const key = call(w.deps, { verb: "export" }).export?.probes.at(-1)?.key;
    const choice = wrong === key ? 0 : wrong;
    const answered = call(w.deps, { verb: "answer", probe: asked?.probe, choice });
    assert.equal(answered.route, "verify");
    const lines = judgeLines(createTranslator("en"), answered);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /^the source says: "/);
  });

  it("the budget holds across sessions", () => {
    const w = world();
    vatConcept(w);
    const claim = keyedClaim(w, "Sellers apply the customer's VAT rate (Directive 2017/2455).");
    const ask = (session: string) => call(w.deps, { verb: "probe", claim, decision: "d1", session });
    assert.equal(ask("s1").ok, true);
    assert.equal(ask("s1").reason, "budget");
    w.fs.tick(3_600_000);
    assert.equal(ask("s2").ok, true);
    w.fs.tick(3_600_000);
    assert.equal(ask("s3").reason, "budget");
    w.fs.tick(8 * 86_400_000);
    assert.equal(ask("s4").ok, true);
  });
});
