import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { actionIssues, perfOutcome, type Sample } from "../src/look/perf.js";
import { fixtureRepo, hasBrowser, lookAt, serverSource } from "./look-fixture.js";
import type { Repo } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

const sample = (overrides: Partial<Sample> = {}): Sample => ({
  lcp: 400,
  cls: 0,
  tbt: 0,
  js: 2000,
  queries: 2,
  ...overrides,
});

describe("perf: budget against the base", () => {
  const store = { routes: { "/": { sample: sample(), last: sample(), tree: "t0", at: "x" } }, accepted: [] };

  it("a regression beyond the tolerance is reported, noise inside it is not", () => {
    const noisy = perfOutcome(
      [{ route: "/", samples: [sample({ lcp: 450 }), sample({ lcp: 520 }), sample({ lcp: 480 })], action: undefined }],
      store,
      "t1",
      "now",
    );
    assert.deepEqual(
      noisy.pages.flatMap((page) => page.issues),
      [],
    );
    const worse = perfOutcome(
      [{ route: "/", samples: [sample({ js: 300_000, queries: 20 })], action: undefined }],
      store,
      "t1",
      "now",
    );
    assert.deepEqual(
      worse.pages.flatMap((page) => page.issues.map((item) => item.selector)),
      ["js", "queries"],
    );
  });

  it("an improvement becomes the new base and an accepted regression is not reported again for its tree", () => {
    const better = perfOutcome(
      [{ route: "/", samples: [sample({ lcp: 200 })], action: undefined }],
      store,
      "t1",
      "now",
    );
    assert.equal(better.store.routes["/"]?.sample.lcp, 200);
    const accepted = { ...store, accepted: [{ route: "/", tree: "t2", reason: "bigger chart", by: "Ana", at: "x" }] };
    const again = perfOutcome(
      [{ route: "/", samples: [sample({ js: 300_000 })], action: undefined }],
      accepted,
      "t2",
      "now",
    );
    assert.deepEqual(
      again.pages.flatMap((page) => page.issues),
      [],
    );
  });

  it("an action that takes 600 ms with no indicator fails, 300 ms warns, an indicator passes", () => {
    const at = (ms: number, indicator: boolean) =>
      actionIssues({ route: "/", samples: [], action: { name: 'button "Save"', ms, indicator } }).map((item) => [
        item.rule,
        item.advisory === true,
      ]);
    assert.deepEqual(at(600, false), [["perf/slow-action", false]]);
    assert.deepEqual(at(300, false), [["perf/slow-action", true]]);
    assert.deepEqual(at(600, true), []);
  });
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300"/></svg>';

const pages = (heavy: boolean) => ({
  "/": {
    body: heavy
      ? '<main><img src="/img.svg"><div style="height:700px">Text that moves when the image arrives.</div><script src="/big.js"></script></main>'
      : '<main><img src="/img.svg" width="400" height="300"><div style="height:700px">Text that stays put.</div><script src="/app.js"></script></main>',
    headers: { "x-db-queries": heavy ? "25" : "2" },
  },
  "/slow":
    "<main><button onclick=\"setTimeout(() => { document.querySelector('p').textContent = 'Saved'; }, 600)\">Save</button><p></p></main>",
  "/img.svg": { body: SVG, type: "image/svg+xml", delayMs: 400 },
  "/app.js": { body: `// ${"a".repeat(1000)}\n`, type: "text/javascript" },
  "/big.js": { body: `// ${"b".repeat(300_000)}\n`, type: "text/javascript" },
});

describe("perf: planted regressions in the browser", () => {
  it("unchanged trees stay under the threshold; a heavier bundle, a layout shift and N+1 queries are reported", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(pages(false), {
      routes: ["/", "/slow"],
      look: ["perf:", "  queries_header: x-db-queries", "  actions:", "    - /slow button Save"],
      policy: "guards:\n  a11y: off\n  keyboard: off\n  ui-states: off\n  ds-adherence: off\n  default-look: off\n",
    });
    repos.push(repo);
    const perf = (run: Awaited<ReturnType<typeof lookAt>>, rule: string) =>
      run.summary.findings.filter((item) => item.rule === rule).map((item) => `${item.route} ${item.selector ?? ""}`);
    const first = await lookAt(repo);
    assert.deepEqual(perf(first, "perf/regression"), []);
    assert.deepEqual(perf(first, "perf/slow-action"), ['/slow button "Save"']);
    assert.deepEqual(perf(await lookAt(repo), "perf/regression"), []);
    repo.write("server.js", serverSource(pages(true)));
    const heavy = await lookAt(repo);
    const found = perf(heavy, "perf/regression");
    for (const metric of ["/ cls", "/ js", "/ queries"]) assert.ok(found.includes(metric), found.join(", "));
  });
});
