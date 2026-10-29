import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { defaultLookIssues } from "../src/look/ds.js";
import { staticPages } from "../src/look/ds-static.js";
import type { ProbeNode } from "../src/look/probe.js";
import { EMPTY_TOKENS, loadTokens } from "../src/look/tokens.js";
import { fixtureRepo, hasBrowser, lookAt } from "./look-fixture.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

const TOKENS = JSON.stringify({
  color: {
    $type: "color",
    ink: { $value: "#000000" },
    paper: { $value: "#ffffff" },
    primary: { $value: "#16a34a" },
  },
  space: { $type: "dimension", one: { $value: "8px" }, two: { $value: "16px" } },
  "font-size": { $type: "dimension", body: { $value: "16px" } },
  radius: { $type: "dimension", sm: { $value: "4px" }, md: { $value: "8px" } },
});

describe("ds-adherence: static layer on the diff", () => {
  it("a literal hex color outside token files is reported with file and line", () => {
    const pages = staticPages(
      [
        { path: "src/button.css", line: 3, text: ".btn { color: #ff0000; padding: 8px; }" },
        { path: "src/tokens.css", line: 1, text: ":root { --primary: #ff0000; }" },
        { path: "src/card.tsx", line: 9, text: '<div className="p-[13px]">x</div>' },
      ],
      { ...EMPTY_TOKENS, lengths: [8, 16] },
      { screens: ["**/*.css", "**/*.tsx"], tokenFiles: ["src/tokens.css"], excludeFiles: [] },
    );
    const found = pages.flatMap((page) => page.issues.map((item) => item.detail));
    assert.deepEqual(found, [
      "src/button.css:3 color literal #ff0000 outside the token files",
      "src/card.tsx:9 arbitrary class literal p-[13px] outside the token files",
    ]);
  });

  it("reads W3C tokens and CSS custom properties", () => {
    const repo = makeRepo({ "tokens.json": TOKENS, "src/vars.css": ":root { --gap: 24px; --brand: #123456; }\n" });
    repos.push(repo);
    const tokens = loadTokens(repoRuntime(), repo.root, ["tokens.json", "src/vars.css"]);
    assert.deepEqual(tokens.lengths, [8, 16, 24]);
    assert.deepEqual(tokens.radii, [4, 8]);
    assert.deepEqual(tokens.fontSizes, [16]);
    assert.equal(tokens.colors.length, 4);
  });
});

const button = (radius: number): ProbeNode => ({
  parent: -1,
  sel: "button.cta",
  tag: "button",
  role: "button",
  name: "Buy",
  text: "Buy",
  visible: true,
  interactive: true,
  field: false,
  labelled: true,
  placeholder: "",
  inline: false,
  native: false,
  alt: null,
  x: 0,
  y: 0,
  w: 120,
  h: 40,
  color: "#000",
  bg: "#fff",
  bgImage: "none",
  opacity: 1,
  fontSize: 16,
  fontWeight: 400,
  fontFamily: "serif",
  lineHeight: 20,
  radius,
  shadow: "none",
  borderColor: "#000",
  borderWidth: 0,
  spacing: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  position: "static",
  clipped: false,
  live: false,
});

describe("default-look: patterns only against the project's own tokens", () => {
  it("a pill button is a finding when the radius tokens stop short of it, and silent when they include it", () => {
    const pill = [button(9999)];
    const short = { ...EMPTY_TOKENS, radii: [4, 8] };
    const full = { ...EMPTY_TOKENS, radii: [4, 9999] };
    assert.deepEqual(
      defaultLookIssues(pill, short, new Set()).map((item) => item.rule),
      ["default-look/pill"],
    );
    assert.deepEqual(defaultLookIssues(pill, full, new Set()), []);
    assert.deepEqual(defaultLookIssues(pill, EMPTY_TOKENS, new Set()), []);
    assert.deepEqual(defaultLookIssues(pill, short, new Set(["button.cta"])), []);
  });
});

const PAGE = [
  "<style>:root{--primary:#16a34a} button{border:0;font-size:16px;padding:8px;color:#000}</style>",
  "<main>",
  '<div class="pad" style="padding:13px">Off scale</div>',
  '<button class="a" style="background:var(--primary)">A</button>',
  '<button class="b" style="background:#2563eb">B</button>',
  '<div class="chart" style="padding:13px"><span style="color:#ff00ff">series</span></div>',
  "</main>",
].join("");

describe("ds-adherence: computed style on the render", () => {
  it("reports off-scale padding and leftovers of the old primary, never excluded selectors", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(
      { "/": PAGE },
      {
        routes: ["/"],
        look: ["ds:", "  tokens:", "    - tokens.json", "  exclude:", '    - ".chart"'],
        policy: "guards:\n  a11y: off\n  keyboard: off\n  ui-states: off\n",
        files: { "tokens.json": TOKENS },
      },
    );
    repos.push(repo);
    const run = await lookAt(repo);
    const found = run.summary.findings
      .filter((item) => item.rule === "ds/off-token" && item.viewport === 1440)
      .map((item) => `${item.route} ${item.selector ?? ""} ${item.detail}`);
    assert.deepEqual(found, [
      "/ body > main > div:nth-of-type(1) padding-top 13px is not a token",
      "/ body > main > div:nth-of-type(1) padding-right 13px is not a token",
      "/ body > main > div:nth-of-type(1) padding-bottom 13px is not a token",
      "/ body > main > div:nth-of-type(1) padding-left 13px is not a token",
      "/ body > main > button:nth-of-type(2) background-color rgb(37, 99, 235) is not a token",
    ]);
  });

  it("with no tokens a proposed token file is written and nothing blocks", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(
      { "/": PAGE },
      { routes: ["/"], policy: "guards:\n  a11y: off\n  keyboard: off\n  ui-states: off\n  ds-adherence: active\n" },
    );
    repos.push(repo);
    const run = await lookAt(repo);
    const ds = run.summary.findings.filter((item) => item.feature === "ds-adherence");
    assert.deepEqual(
      ds.map((item) => [item.rule, item.unverified === true]),
      [["ds/no-tokens", true]],
    );
    assert.ok(!run.summary.findings.some((item) => item.blocking));
    assert.ok(existsSync(join(repo.root, ".finitemonkey", "look", run.summary.treeHash, "tokens.proposed.json")));
  });
});
