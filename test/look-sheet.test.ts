import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";

import { runSheet } from "../src/look/node-sheet-run.js";
import { buildSheet, diffSheets, nestedRadiusIssues, type SheetView } from "../src/look/sheet.js";
import { renderSheet } from "../src/look/sheet-render.js";
import { EMPTY_TOKENS } from "../src/look/tokens.js";
import { fixtureRepo, hasBrowser, serverSource } from "./look-fixture.js";
import { type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

const element = (
  key: string,
  depth: number,
  values: Readonly<Record<string, number>>,
  box = { x: 0, y: 0, w: 100, h: 40 },
) => ({
  key,
  slot: "GENERIC · HUG",
  depth,
  box,
  values,
  layer: undefined,
});

describe("sheet: drawing from measured values", () => {
  it("a value absent at one width renders as [unmeasured]", () => {
    const wide: SheetView = {
      width: 1440,
      state: "ideal",
      placement: { x: 0, w: 1440, fill: true },
      elements: [element(".a", 0, { "padding-top": 8 }), element(".b", 1, { "padding-top": 8 })],
    };
    const narrow: SheetView = {
      width: 320,
      state: "ideal",
      placement: null,
      elements: [element(".a", 0, { "padding-top": 8 })],
    };
    const html = renderSheet({
      schema: "finitemonkey/look-sheet@1",
      route: "/",
      selector: "main",
      tree: "t",
      views: [wide, narrow],
      variables: [],
      issues: [],
    });
    assert.ok(html.includes("[unmeasured]"));
  });

  it("the nested radius must equal outer radius minus border and padding", () => {
    const outer = element(
      ".card",
      0,
      { radius: 16, border: 0, "padding-left": 8, "padding-top": 8 },
      { x: 0, y: 0, w: 200, h: 100 },
    );
    const good = element(".inner", 1, { radius: 8 }, { x: 8, y: 8, w: 184, h: 40 });
    const bad = element(".inner", 1, { radius: 16 }, { x: 8, y: 8, w: 184, h: 40 });
    const view = (inner: typeof good): SheetView => ({
      width: 390,
      state: "ideal",
      placement: null,
      elements: [outer, inner],
    });
    assert.deepEqual(nestedRadiusIssues([view(good)]), []);
    assert.deepEqual(
      nestedRadiusIssues([view(bad)]).map((item) => item.rule),
      ["sheet/nested-radius"],
    );
  });

  it("two sheets at different trees produce a dimension-level diff", () => {
    const sheet = (padding: number) => ({
      ...buildSheet({ route: "/", selector: "main", tree: String(padding), views: [], tokens: EMPTY_TOKENS }),
      views: [
        { width: 390, state: "ideal", placement: null, elements: [element(".a", 0, { "padding-top": padding })] },
      ],
    });
    assert.deepEqual(diffSheets(sheet(8), sheet(12)), [
      { width: 390, state: "ideal", key: ".a", property: "padding-top", from: 8, to: 12 },
    ]);
  });
});

const TOKENS = JSON.stringify({
  space: { $type: "dimension", s1: { $value: "8px" }, s2: { $value: "16px" } },
  radius: { $type: "dimension", md: { $value: "8px" } },
});

const CARD = (padding: number): string =>
  [
    `<style>.card{display:flex;flex-direction:column;gap:8px;padding:${String(padding)}px;border-radius:16px;border:0;background:#eee}`,
    ".inner{border-radius:16px;background:#ddd;padding:8px}@media (max-width:500px){.extra{display:none}}</style>",
    '<main><div class="card"><div class="inner">Zebra Quartz headline</div><div class="extra">Hidden on phones</div></div></main>',
  ].join("");

describe("sheet: rendered page", () => {
  it("measures at four widths and mocked states, flags off-scale and nested radius, leaves copy out, diffs against the approved sheet", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(
      { "/card": CARD(16), "/card?mock=empty": "<main><p>Nothing yet</p></main>" },
      {
        routes: ["/card"],
        look: ["states:", "  /card:", "    - empty empty", "ds:", "  tokens:", "    - tokens.json"],
        files: { "tokens.json": TOKENS },
      },
    );
    repos.push(repo);
    const run = await runSheet(repoRuntime(), repo.root, "/card", ".card");
    if (run.kind !== "done") throw new Error(JSON.stringify(run));
    const html = repo.read(run.html.slice(repo.root.length + 1));
    for (const width of [320, 390, 768, 1440]) assert.ok(html.includes(`${String(width)}px · ideal`), String(width));
    assert.ok(html.includes("1440px · empty"));
    assert.ok(html.includes("[unmeasured]"));
    assert.ok(!html.includes("Zebra") && !html.includes("Hidden on phones"));
    const rules = run.sheet.issues.map((item) => item.rule);
    assert.ok(rules.includes("sheet/off-scale"));
    assert.ok(rules.includes("sheet/nested-radius"));
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    const approved = await cliJson(["look", "sheet", "/card", "--selector", ".card", "--approve"], {
      runtime: repoRuntime(),
      cwd: repo.root,
      stdin: tty,
    });
    assert.equal(approved.code, 0, approved.stdout);
    repo.write("server.js", serverSource({ "/card": CARD(8), "/card?mock=empty": "<main><p>Nothing yet</p></main>" }));
    const next = await runSheet(repoRuntime(), repo.root, "/card", ".card");
    if (next.kind !== "done") throw new Error(JSON.stringify(next));
    assert.ok(
      (next.diff ?? []).some((change) => change.property === "padding-top" && change.from === 16 && change.to === 8),
    );
    assert.equal(field(approved.body, "data", "approved"), true);
  });
});
