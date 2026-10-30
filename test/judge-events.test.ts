import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { citeVerifier } from "../src/judge/cite.js";
import type { Fetched } from "../src/judge/fetch.js";
import { parseRequest } from "../src/judge/request.js";
import { appendEntry } from "../src/judge/store.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { proposeContradictions } from "../src/judge/verbs-events.js";
import { DEFAULT_VERIFIERS } from "../src/judge/verify.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const OLD = "<p>The reduced rate for e-books is 7% in Germany.</p>";
const NEW = "<p>Since 2026 the rate for e-books in Germany is the standard 19%.</p>";

interface World {
  readonly fs: MemoryFs;
  readonly deps: JudgeDeps;
}

const world = (): World => {
  const fs = memoryFs({}, [toAbsolutePath("/home/ana/project/.finitemonkey")]);
  const pages: Readonly<Record<string, string>> = { "10.1000/old": OLD, "10.1000/new": NEW };
  return {
    fs,
    deps: {
      runtime: fakeRuntime({ fs }),
      paths: fmPaths(toAbsolutePath("/home/ana/project")),
      fetcher: (id): Fetched => {
        const page = pages[id];
        return page === undefined ? { status: "not-found" } : { status: "ok", content: page };
      },
      verifiers: { ...DEFAULT_VERIFIERS, "source-span": citeVerifier },
    },
  };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const claim = (w: World, text: string): string => {
  w.fs.tick(1000);
  return call(w.deps, { verb: "classify", file: `${String(text.length)}.md`, text }).result?.rows[0]?.claim ?? "";
};

const QUOTED = '"The reduced rate for e-books is 7% in Germany" ([Old](https://doi.org/10.1000/old)).';

describe("ricochet events for research claims", () => {
  it("a retracted claim opens an event for itself and for each claim resting on it", () => {
    const w = world();
    const base = claim(w, QUOTED);
    const price = claim(w, "Our e-book price in Germany includes 7% VAT.");
    const margin = claim(w, "Our German margin on e-books is 31% after VAT.");
    call(w.deps, { verb: "depend", claim: price, on: base });
    call(w.deps, { verb: "depend", claim: margin, on: price });
    const events = call(w.deps, { verb: "retract", claim: base }).events ?? [];
    assert.deepEqual(
      events.map((event) => [event.claim, event.cause]),
      [
        [base, "retracted"],
        [price, "retracted"],
        [margin, "retracted"],
      ],
    );
  });

  it("an event keeps the band and support state the claim had at acceptance", () => {
    const w = world();
    const vat =
      call(w.deps, { verb: "concept", label: "e-books", domain: "tax-law", source: "10.1000/old", span: "e-books" })
        .entry ?? "";
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
    const id = claim(w, QUOTED);
    w.fs.tick(1000);
    assert.equal(call(w.deps, { verb: "verify", claim: id }).claim?.state, "machine-verified");
    w.fs.tick(1000);
    const opened = call(w.deps, {
      verb: "contradict",
      claim: id,
      source: "10.1000/new",
      span: "the rate for e-books in Germany is the standard 19%",
    }).events?.[0];
    assert.equal(opened?.support, "machine-verified");
    assert.deepEqual(opened.bands, { [vat]: "demonstrated" });
    const now = call(w.deps, { verb: "fade", concept: vat }).concepts?.[0]?.band;
    assert.equal(now, "proximal");
    assert.deepEqual(call(w.deps, { verb: "trajectory" }).events?.[0]?.bands, { [vat]: "demonstrated" });
  });

  it("a proposed contradiction opens nothing without a span match or the person's confirmation", () => {
    const w = world();
    const id = claim(w, QUOTED);
    const proposed = proposeContradictions(w.deps, id, () => [{ source: "10.1000/new", span: "e-books are exempt" }]);
    assert.equal(proposed.length, 1);
    const tried = call(w.deps, { verb: "contradict", claim: id, ...proposed[0] });
    assert.equal(tried.reason, "no_span_match");
    assert.deepEqual(call(w.deps, { verb: "trajectory" }).events, []);
    const confirmed = call(w.deps, { verb: "contradict", claim: id, ...proposed[0], confirmed: true });
    assert.equal(confirmed.events?.length, 1);
  });

  it("a disagreement only in scope stays pending with both sources", () => {
    const w = world();
    const id = claim(w, QUOTED);
    call(w.deps, { verb: "verify", claim: id });
    const pending = call(w.deps, {
      verb: "contradict",
      claim: id,
      source: "10.1000/new",
      span: "standard 19%",
      scope: true,
    }).events?.[0];
    assert.equal(pending?.state, "pending");
    assert.deepEqual(pending.sources, ["10.1000/old", "10.1000/new"]);
  });

  it("a repair made by the person is marked held", () => {
    const w = world();
    const id = claim(w, QUOTED);
    const event = call(w.deps, { verb: "failed", claim: id }).events?.[0]?.id;
    const fixed = call(w.deps, { verb: "fixed", event, by: "person" }).events?.[0];
    assert.equal(fixed?.state, "held");
    assert.equal(fixed.fixedBy, "person");
  });
});
