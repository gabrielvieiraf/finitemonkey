import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";

import { flowPages } from "../src/look/flow.js";
import { approveJourney, journeyState, parseJourney, proposeJourney } from "../src/look/journey.js";
import { fmPaths } from "../src/task/paths.js";
import { fixtureRepo, hasBrowser, lookAt } from "./look-fixture.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

const JOURNEY = [
  "says: open the orders from home and see the list",
  "steps:",
  "  - goto: /",
  "    expect:",
  "      text: Orders",
  "  - click:",
  "      role: link",
  "      name: Orders",
  "    expect:",
  "      url: /orders",
  "",
].join("\n");

describe("flow: graph rules", () => {
  it("a success page without a next action and an orphan route are both reported; terminal screens are not", () => {
    const nodes = [
      { route: "/", links: ["/orders"], back: false },
      { route: "/orders", links: ["/", "/success"], back: false },
      { route: "/success", links: [], back: false },
      { route: "/receipt", links: [], back: false },
    ];
    const spec = {
      entry: "/",
      declared: ["/", "/orders", "/orphan", "/receipt"],
      terminal: ["/receipt"],
      steps: { "/orders": 0 },
      back: {},
    };
    const found = flowPages(nodes, spec).flatMap((page) => page.issues.map((item) => `${page.route} ${item.rule}`));
    assert.deepEqual(found, [
      "/success flow/dead-end",
      "/orphan flow/unreachable",
      "/receipt flow/unreachable",
      "/orders flow/steps",
    ]);
  });
});

describe("journeys: approval", () => {
  it("every step needs an oracle, and editing a journey invalidates its approval", () => {
    assert.ok(parseJourney("orders", JOURNEY).ok);
    const missing = parseJourney("orders", "says: x\nsteps:\n  - goto: /\n    expect: {}\n");
    assert.ok(!missing.ok);
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    assert.ok(proposeJourney(runtime, paths, "orders", JOURNEY).ok);
    assert.ok(approveJourney(runtime, paths, "orders", undefined).ok);
    assert.equal(journeyState(runtime, paths, "orders")?.approved, true);
    assert.ok(proposeJourney(runtime, paths, "orders", JOURNEY.replace("see the list", "see every order")).ok);
    assert.equal(journeyState(runtime, paths, "orders")?.approved, false);
  });

  it("only the person approves a journey", async () => {
    const repo = makeRepo({ "README.md": "x\n", "j.yml": JOURNEY });
    repos.push(repo);
    const runtime = repoRuntime();
    assert.equal(
      (await cliJson(["journey", "propose", "orders", "--from", "j.yml"], { runtime, cwd: repo.root })).code,
      0,
    );
    const agent = await cliJson(["journey", "approve", "orders"], {
      runtime,
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(agent.code, 0);
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    assert.equal((await cliJson(["journey", "approve", "orders"], { runtime, cwd: repo.root, stdin: tty })).code, 0);
  });
});

const PAGES = {
  "/": '<main><a href="/orders">Orders</a> <a href="/safe">Safe</a> <a href="/draft">Draft</a> <a href="/kept">Kept</a></main>',
  "/orders":
    '<main><h1>Orders</h1><a href="/">Home</a> <a href="/success">Done</a><ul><li>Book <button id="del" onclick="this.closest(\'li\').remove()">Delete</button></li></ul></main>',
  "/success": "<main><h1>Saved</h1></main>",
  "/orphan": '<main><a href="/">Home</a></main>',
  "/safe": '<main><a href="/">Home</a><button id="del" onclick="confirm(\'Delete it?\')">Delete</button></main>',
  "/draft": '<main><a href="/">Home</a><input id="note" aria-label="Note"></main>',
  "/kept":
    '<main><a href="/">Home</a><input id="note" aria-label="Note"><script>note.value = localStorage.getItem("n") || ""; note.oninput = () => localStorage.setItem("n", note.value);</script></main>',
};

describe("flow and journeys: fixtures in the browser", () => {
  it("reports dead ends, orphans, unguarded deletes and lost drafts; an approved journey runs green and kills its mutant", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(PAGES, {
      routes: ["/", "/orders", "/orphan"],
      look: [
        "flow:",
        "  destructive:",
        '    - "/orders #del"',
        '    - "/safe #del"',
        "  drafts:",
        '    - "/draft #note"',
        '    - "/kept #note"',
      ],
      policy: "guards:\n  a11y: off\n  keyboard: off\n  ui-states: off\n  ds-adherence: off\n  default-look: off\n",
      files: { ".finitemonkey/look/journeys/orders.yml": JOURNEY },
    });
    repos.push(repo);
    assert.ok(approveJourney(repoRuntime(), fmPaths(repo.root), "orders", undefined).ok);
    const run = await lookAt(repo);
    const found = (feature: string) =>
      run.summary.findings
        .filter((item) => item.feature === feature)
        .map((item) => `${item.route} ${item.rule}`)
        .sort();
    assert.deepEqual(found("ui-flow"), [
      "/draft flow/draft-lost",
      "/orders flow/destructive",
      "/orphan flow/unreachable",
      "/success flow/dead-end",
    ]);
    assert.deepEqual(found("journeys"), []);
    const ux = repo.read(`.finitemonkey/look/${run.summary.treeHash}/ux.json`);
    assert.ok(ux.includes('"passed": 1') && ux.includes('"mutants": 1') && ux.includes('"killed": 1'), ux.slice(-600));
  });
});
