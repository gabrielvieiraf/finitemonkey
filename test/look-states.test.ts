import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { loadingIssues, parseStateSpec } from "../src/look/states.js";
import { fixtureRepo, hasBrowser, lookAt } from "./look-fixture.js";
import type { Repo } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

describe("ui-states: declared states", () => {
  it("parses a state with and without a mock and ignores unknown names", () => {
    assert.deepEqual(parseStateSpec("empty no-orders"), { state: "empty", mock: "no-orders" });
    assert.deepEqual(parseStateSpec("partial"), { state: "partial", mock: undefined });
    assert.equal(parseStateSpec("sleepy x"), undefined);
  });

  it("loading passes with an indicator or content inside 400 ms, and fails otherwise", () => {
    assert.deepEqual(loadingIssues({ indicator: true, settledMs: undefined }), []);
    assert.deepEqual(loadingIssues({ indicator: false, settledMs: 120 }), []);
    assert.deepEqual(
      loadingIssues({ indicator: false, settledMs: undefined }).map((item) => item.rule),
      ["ui-states/loading"],
    );
  });
});

const LOADER = (indicator: string): string =>
  `<main id="m">${indicator}</main><script>fetch('/api/slow').then((r) => r.text()).then((t) => { m.textContent = t; })</script>`;

const PAGES = {
  "/orders": "<main><h1>Orders</h1><p>Order 1</p></main>",
  "/orders?mock=err":
    '<main><div role="alert" style="background:#16a34a;color:#fff;padding:8px">Could not load orders</div></main>',
  "/orders?mock=empty": "<main></main>",
  "/orders?mock=slow": LOADER(""),
  "/good": "<main><h1>Orders</h1><p>Order 1</p></main>",
  "/good?mock=err":
    '<main><div role="alert" style="background:#fee;color:#900;padding:8px">Could not load orders <button>Try again</button></div></main>',
  "/good?mock=empty": '<main><p>No orders yet</p><a href="/new">Create an order</a></main>',
  "/good?mock=slow": LOADER('<div role="progressbar" aria-label="Loading">Loading</div>'),
  "/api/slow": { body: "Order 1", type: "text/plain", delayMs: 1500 },
  "/counter":
    '<main><span id="c">0</span><script>let n = 0; setInterval(() => { c.textContent = ++n; }, 200);</script></main>',
  "/announced":
    '<main><span id="c" role="status">0</span><script>let n = 0; setInterval(() => { c.textContent = ++n; }, 200);</script></main>',
};

describe("ui-states: fixtures through mocks", () => {
  it("reports the planted state defects and nothing on the clean twin", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(PAGES, {
      routes: ["/orders", "/good", "/counter", "/announced"],
      look: [
        "states:",
        "  /orders:",
        "    - empty empty",
        "    - error err",
        "    - loading slow",
        "    - partial",
        "  /good:",
        "    - empty empty",
        "    - error err",
        "    - loading slow",
      ],
      policy: "guards:\n  a11y: off\n  keyboard: off\n",
    });
    repos.push(repo);
    const run = await lookAt(repo);
    const at = (route: string) =>
      run.summary.findings
        .filter((item) => item.feature === "ui-states" && item.route === route && item.viewport === 1440)
        .map((item) => item.rule)
        .sort();
    assert.deepEqual(at("/orders?mock=err"), ["ui-states/error-action", "ui-states/error-color"]);
    assert.deepEqual(at("/orders?mock=empty"), ["ui-states/empty"]);
    assert.deepEqual(at("/orders?mock=slow"), ["ui-states/loading"]);
    assert.deepEqual(at("/orders"), ["ui-states/not-covered"]);
    assert.deepEqual(at("/counter"), ["ui-states/status"]);
    for (const route of ["/good", "/good?mock=err", "/good?mock=empty", "/good?mock=slow", "/announced"])
      assert.deepEqual(at(route), [], route);
  });
});
