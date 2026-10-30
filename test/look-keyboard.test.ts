import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { EMPTY_BASELINE } from "../src/findings/baseline.js";
import { keyboardIssues, type ObservedStop } from "../src/look/keyboard.js";
import { governUx } from "../src/look/ux-govern.js";
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

const stop = (sel: string, y: number, overrides: Partial<ObservedStop> = {}): ObservedStop => ({
  sel,
  role: "button",
  name: sel,
  x: 0,
  y,
  w: 80,
  h: 30,
  obscured: false,
  composite: null,
  modal: false,
  changed: true,
  ...overrides,
});

describe("keyboard: findings from a recorded walk", () => {
  it("an element never reached is reported, a roving composite counts as one stop", () => {
    const walk = { stops: [stop("#a", 0), stop("#tab1", 40, { composite: "#tabs" })], complete: true, trap: undefined };
    const found = keyboardIssues(
      walk,
      [
        { sel: "#a", composite: null },
        { sel: "#tab1", composite: "#tabs" },
        { sel: "#tab2", composite: "#tabs" },
        { sel: "#lost", composite: null },
      ],
      [],
    );
    assert.deepEqual(
      found.map((item) => [item.rule, item.selector]),
      [["keyboard/unreachable", "#lost"]],
    );
  });

  it("order is advisory and never blocks, even in active mode", () => {
    const walk = { stops: [stop("#low", 400), stop("#high", 10)], complete: true, trap: undefined };
    const found = keyboardIssues(walk, [], []);
    assert.deepEqual(
      found.map((item) => [item.rule, item.advisory]),
      [["keyboard/order", true]],
    );
    const governed = governUx({
      pages: [{ feature: "keyboard", route: "/", viewport: 390, issues: found }],
      modes: { keyboard: "active" },
      baseline: EMPTY_BASELINE,
      now: "2026-10-29T00:00:00.000Z",
      muted: () => false,
    });
    assert.ok(governed.findings.every((item) => !item.blocking));
  });

  it("a trap inside a modal is not a finding; outside one it is", () => {
    const stops = [stop("#before", 0), stop("#a", 40), stop("#b", 80)];
    const outside = keyboardIssues(
      { stops, complete: false, trap: { cycle: ["#a", "#b"], escaped: false, modal: false } },
      [],
      [],
    );
    assert.deepEqual(
      outside.map((item) => item.rule),
      ["keyboard/trap"],
    );
    const modal = keyboardIssues(
      { stops, complete: false, trap: { cycle: ["#a", "#b"], escaped: false, modal: true } },
      [],
      [],
    );
    assert.deepEqual(modal, []);
  });
});

const PAGES = {
  "/unreachable": '<main><button>One</button><div role="button">Fake</div><button>Two</button></main>',
  "/trap": [
    '<main><button>Before</button><input id="a" aria-label="a"><input id="b" aria-label="b"><button>After</button>',
    "<script>",
    "b.addEventListener('keydown', (e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); a.focus(); } });",
    "a.addEventListener('keydown', (e) => { if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); b.focus(); } });",
    "</script></main>",
  ].join(""),
  "/outline": "<style>button:focus{outline:none}</style><main><button>Plain</button></main>",
  "/under": [
    '<header style="position:fixed;top:0;left:0;right:0;height:120px;background:#fff">Head</header>',
    '<main><input aria-label="Name" style="margin-top:30px"></main>',
  ].join(""),
  "/dialog": [
    '<main><button id="launch">Open</button><div id="d" role="dialog" hidden><button id="x">Close</button></div>',
    "<script>",
    "launch.onclick = () => { d.hidden = false; x.focus(); };",
    "document.addEventListener('keydown', (e) => { if (e.key === 'Escape') d.hidden = true; });",
    "</script></main>",
  ].join(""),
  "/clean": [
    '<main><button id="launch">One</button><div role="button" tabindex="0">Fake</div><input aria-label="field">',
    '<div id="d" role="dialog" hidden><button id="x">Close</button></div>',
    "<script>",
    "launch.onclick = () => { d.hidden = false; x.focus(); };",
    "document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { d.hidden = true; launch.focus(); } });",
    "</script></main>",
  ].join(""),
};

describe("keyboard: fixtures against a clean twin", () => {
  it("each planted keyboard failure yields its finding and the clean twin yields none", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const routes = Object.keys(PAGES);
    const repo = await fixtureRepo(PAGES, {
      routes,
      look: ["keyboard:", "  dialogs:", '    - "/dialog #launch"', '    - "/clean #launch"'],
      policy: "guards:\n  a11y: off\n",
    });
    repos.push(repo);
    const run = await lookAt(repo);
    const rules = (route: string) => [
      ...new Set(
        run.summary.findings
          .filter((item) => item.feature === "keyboard" && item.route === route && item.viewport === 1440)
          .map((item) => `${item.rule} ${item.selector ?? ""}`),
      ),
    ];
    assert.deepEqual(rules("/unreachable"), ["keyboard/unreachable body > main > div"]);
    assert.deepEqual(rules("/trap"), ["keyboard/trap #a"]);
    assert.deepEqual(rules("/outline"), ["keyboard/focus-invisible body > main > button"]);
    assert.deepEqual(rules("/under"), ["keyboard/focus-obscured body > main > input"]);
    assert.deepEqual(rules("/dialog"), ["keyboard/dialog #launch"]);
    assert.deepEqual(rules("/clean"), []);
    assert.ok(run.summary.findings.every((item) => !item.blocking));
    const dir = join(repo.root, ".finitemonkey", "look", run.summary.treeHash);
    assert.ok(existsSync(join(dir, "clean-1440.focus.png")));
  });
});
