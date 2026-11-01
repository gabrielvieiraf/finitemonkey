import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Fetched } from "../src/judge/fetch.js";
import { parseRequest } from "../src/judge/request.js";
import { contentHash } from "../src/judge/span.js";
import { appendEntry, readEntries } from "../src/judge/store.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { proposeContradictions } from "../src/judge/verbs-events.js";
import { proposeHelps } from "../src/judge/verbs-horizon.js";
import { providerClaimContradictions, providerHorizon } from "../src/provider/adapters.js";
import type { ProviderKind } from "../src/provider/kinds.js";
import { providerJudge } from "../src/provider/wire.js";
import { answer, type FakeClaude, MALFORMED, world } from "./provider-support.js";

const SOURCE = [
  "<p>Distance sellers must apply the VAT rate of the customer's member state.</p>",
  "<p>The threshold for distance sales is 10,000 euros across the union.</p>",
].join("\n");
const SPAN = "Distance sellers must apply the VAT rate of the customer's member state";
const NOTE = "Sellers apply the customer's VAT rate (Directive 2017/2455). The threshold is 10,000 euros.";

const judgeWorld = (kinds: readonly ProviderKind[], fake: FakeClaude) => {
  const w = world({ kinds, mode: "active", fake });
  const deps: JudgeDeps = {
    runtime: w.runtime,
    paths: w.paths,
    fetcher: (id): Fetched => (id === "10.1000/vat" ? { status: "ok", content: SOURCE } : { status: "not-found" }),
    ...providerJudge(w.deps),
  };
  return { ...w, judge: deps };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const AUTHORITY = new Set(["evidence", "support", "contest", "event"]);

const authority = (deps: JudgeDeps): string =>
  JSON.stringify(
    readEntries(deps.runtime, deps.paths)
      .filter((entry) => AUTHORITY.has(entry.type))
      .map((entry) => ({ ...entry, at: "" })),
  );

const bands = (deps: JudgeDeps): string =>
  JSON.stringify((call(deps, { verb: "report" }).concepts ?? []).map((item) => [item.concept, item.band]));

const vat = (deps: JudgeDeps): void => {
  call(deps, { verb: "concept", label: "VAT", domain: "tax-law", source: "10.1000/vat", span: SPAN });
};

const YES: Readonly<Record<string, FakeClaude>> = {
  support: { answer: answer({ proposal: "supported" }) },
  "claim-split": { answer: answer(["correct", "supported"]) },
  concepts: { answer: answer([{ label: "correct", domain: "tax-law" }]) },
  distractors: { answer: answer([SPAN, "correct"]) },
  horizon: { answer: answer([{ kind: "concept", text: "correct", criterion: "source-span", answer: "supported" }]) },
  "claim-contradictions": { answer: answer([{ source: "10.1000/vat", span: "supported" }]) },
};

const states = (deps: JudgeDeps, rows: readonly { readonly claim: string }[]): readonly unknown[] =>
  rows.map((row) => call(deps, { verb: "verify", claim: row.claim }).claim?.state);

const classified = (deps: JudgeDeps) =>
  call(deps, { verb: "classify", file: "note.md", text: NOTE }).result?.rows ?? [];

const keyed = (deps: JudgeDeps, claim: string): void => {
  const record = {
    type: "support",
    id: `s-${claim}`,
    at: deps.runtime.now(),
    claim,
    state: "model-only",
    by: "machine",
    outcome: "anchored",
    anchors: [{ kind: "span", ref: "10.1000/vat", span: SPAN, hash: contentHash(SOURCE) }],
  };
  assert.equal(appendEntry(deps.runtime, deps.paths, record).ok, true);
};

describe("a malformed or yes-saying model changes nothing that decides", () => {
  it("a malformed or yes-saying model moves no support state, band or concept", () => {
    for (const fake of [MALFORMED, YES["support"] ?? MALFORMED]) {
      const w = judgeWorld(["support"], fake);
      vat(w.judge);
      const before = bands(w.judge);
      for (const state of states(w.judge, classified(w.judge))) assert.equal(state, "model-only");
      assert.equal(bands(w.judge), before);
      assert.ok(w.calls.length > 0);
    }
  });

  for (const kind of ["claim-split", "concepts"] as const) {
    it(`${kind}: no support state or band moves`, () => {
      for (const fake of [MALFORMED, YES[kind] ?? MALFORMED]) {
        const w = judgeWorld([kind], fake);
        vat(w.judge);
        const rows = classified(w.judge);
        call(w.judge, { verb: "observe", text: NOTE });
        assert.equal(rows.length > 0, fake === MALFORMED || kind === "concepts");
        for (const state of states(w.judge, rows)) assert.equal(state, "model-only");
        assert.equal(authority(w.judge).includes("machine-verified"), false);
        for (const concept of call(w.judge, { verb: "report" }).concepts ?? []) assert.equal(concept.band, "no record");
        assert.ok(w.calls.length > 0, kind);
      }
    });
  }

  it("distractors: the answer key stays the source span and no evidence is recorded", () => {
    for (const fake of [MALFORMED, YES["distractors"] ?? MALFORMED]) {
      const w = judgeWorld(["distractors"], fake);
      vat(w.judge);
      const claim = classified(w.judge)[0]?.claim ?? "";
      keyed(w.judge, claim);
      const before = authority(w.judge);
      const asked = call(w.judge, { verb: "probe", claim, decision: "d1" }).probe;
      const stored = call(w.judge, { verb: "export" }).export?.probes.at(-1);
      assert.ok(asked !== undefined && stored !== undefined);
      assert.ok(!SOURCE.includes(stored.options[stored.key] ?? SPAN));
      assert.equal(authority(w.judge), before);
      assert.ok(w.calls.length > 0);
    }
  });

  it("horizon: proposed help is only shown and never moves a band", () => {
    for (const fake of [MALFORMED, YES["horizon"] ?? MALFORMED]) {
      const w = judgeWorld(["horizon"], fake);
      vat(w.judge);
      const before = [bands(w.judge), authority(w.judge)];
      const shown = proposeHelps(w.judge, { text: NOTE, domain: "tax-law" }, providerHorizon(w.deps)).horizon ?? [];
      for (const help of shown) assert.equal(help.state, "shown");
      assert.equal(shown.length, fake === MALFORMED ? 0 : 1);
      assert.deepEqual([bands(w.judge), authority(w.judge)], before);
    }
  });

  it("claim-contradictions: a proposal opens no event and moves no support state", () => {
    for (const fake of [MALFORMED, YES["claim-contradictions"] ?? MALFORMED]) {
      const w = judgeWorld(["claim-contradictions"], fake);
      const claim = classified(w.judge)[0]?.claim ?? "";
      const before = authority(w.judge);
      const proposed = proposeContradictions(w.judge, claim, providerClaimContradictions(w.deps));
      assert.equal(proposed.length, fake === MALFORMED ? 0 : 1);
      assert.equal(authority(w.judge), before);
    }
  });
});
