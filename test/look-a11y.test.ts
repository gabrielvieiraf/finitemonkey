import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { EMPTY_BASELINE, saveBaseline } from "../src/findings/baseline.js";
import { a11yIssues, contrastFails, targetIssues } from "../src/look/a11y.js";
import { contrastRatio, parseColor } from "../src/look/color.js";
import type { ProbeNode, ProbeResult } from "../src/look/probe.js";
import type { UxPage } from "../src/look/ux.js";
import { governUx, uxFindingId } from "../src/look/ux-govern.js";
import { fixtureRepo, hasBrowser, lookAt } from "./look-fixture.js";
import { type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

const node = (overrides: Partial<ProbeNode>): ProbeNode => ({
  parent: -1,
  sel: "body",
  tag: "div",
  role: "",
  name: "",
  text: "",
  visible: true,
  interactive: false,
  field: false,
  labelled: true,
  placeholder: "",
  inline: false,
  native: false,
  alt: null,
  x: 0,
  y: 0,
  w: 100,
  h: 20,
  color: "rgb(0, 0, 0)",
  bg: "rgba(0, 0, 0, 0)",
  bgImage: "none",
  opacity: 1,
  fontSize: 16,
  fontWeight: 400,
  fontFamily: "sans-serif",
  lineHeight: 20,
  radius: 0,
  shadow: "none",
  borderColor: "rgb(0, 0, 0)",
  borderWidth: 0,
  spacing: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  position: "static",
  clipped: false,
  live: false,
  ...overrides,
});

const probe = (nodes: readonly ProbeNode[], scrollWidth = 320): ProbeResult => ({
  scrollWidth,
  clientWidth: 320,
  lang: "en",
  truncated: false,
  nodes: [
    node({ tag: "body", bg: "rgb(255, 255, 255)" }),
    node({ sel: "main", tag: "main", role: "main", parent: 0 }),
    ...nodes,
  ],
});

const color = (text: string) => {
  const parsed = parseColor(text);
  if (parsed === undefined) throw new Error(`bad color ${text}`);
  return parsed;
};

describe("a11y: rules computed from the rendered page", () => {
  it("a 4.499:1 pair fails, a 4.5:1 pair passes, nothing is rounded", () => {
    assert.equal(contrastFails(4.499, false), true);
    assert.equal(contrastFails(4.5, false), false);
    assert.equal(contrastFails(2.999, true), true);
    assert.equal(contrastFails(3, true), false);
    const passing = contrastRatio(color("#767676"), color("#ffffff"));
    const failing = contrastRatio(color("#777777"), color("#ffffff"));
    assert.ok(passing >= 4.5 && passing < 4.6);
    assert.ok(failing < 4.5 && failing > 4.4);
    const page = probe([
      node({ sel: "p.ok", parent: 1, text: "fine", color: "#767676" }),
      node({ sel: "p.bad", parent: 1, text: "faint", color: "#777777" }),
    ]);
    assert.deepEqual(
      a11yIssues(page, { target: 24, width: 390 }).map((item) => item.selector),
      ["p.bad"],
    );
  });

  it("a 20x20 target with room passes; two adjacent 20x20 targets both fail", () => {
    const alone = [
      { sel: "a", x: 0, y: 0, w: 20, h: 20 },
      { sel: "b", x: 100, y: 0, w: 20, h: 20 },
    ];
    assert.deepEqual(targetIssues(alone, 24), []);
    const close = [
      { sel: "a", x: 0, y: 0, w: 20, h: 20 },
      { sel: "b", x: 20, y: 0, w: 20, h: 20 },
    ];
    assert.deepEqual(
      targetIssues(close, 24).map((item) => item.selector),
      ["a", "b"],
    );
    assert.deepEqual(targetIssues([{ sel: "c", x: 0, y: 0, w: 40, h: 40 }], 44).length, 1);
  });

  it("text over a gradient is not verified, never failed or passed", () => {
    const page = probe([
      node({ sel: "div.hero", parent: 1, bgImage: "linear-gradient(red, blue)" }),
      node({ sel: "div.hero > p", parent: 2, text: "over a gradient", color: "#fff" }),
    ]);
    const found = a11yIssues(page, { target: 24, width: 390 });
    assert.deepEqual(
      found.map((item) => [item.rule, item.unverified === true]),
      [["a11y/contrast", true]],
    );
  });

  it("reflow counts only at 320 px and inline targets are exempt", () => {
    const wide = probe([], 400);
    assert.ok(a11yIssues(wide, { target: 24, width: 320 }).some((item) => item.rule === "a11y/reflow"));
    assert.ok(!a11yIssues(wide, { target: 24, width: 390 }).some((item) => item.rule === "a11y/reflow"));
    const inline = probe([
      node({ sel: "a.one", parent: 1, interactive: true, role: "link", name: "x", inline: true, w: 10, h: 10 }),
      node({ sel: "a.two", parent: 1, interactive: true, role: "link", name: "y", inline: true, x: 12, w: 10, h: 10 }),
    ]);
    assert.deepEqual(a11yIssues(inline, { target: 24, width: 390 }), []);
  });
});

const page = (feature: string, rule: "a11y/contrast", selector: string, unverified = false): UxPage => ({
  feature,
  route: "/",
  viewport: 390,
  issues: [{ rule, selector, detail: "x", ...(unverified ? { unverified: true as const } : {}) }],
});

describe("a11y: baseline ratchet and modes", () => {
  const now = "2026-10-29T00:00:00.000Z";
  const known = uxFindingId("a11y", "a11y/contrast", "/", 390, "p.old");
  const baseline = {
    ...EMPTY_BASELINE,
    entries: [
      {
        check: "a11y",
        id: known,
        rule: "a11y/contrast",
        file: "/",
        line: 390,
        fingerprint: "390 p.old",
        state: "aceito" as const,
        owner: "p",
        reason: "legacy",
        acceptedAt: now,
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
    ],
  };

  it("in active mode a new violation blocks and a baseline one does not", () => {
    const governed = governUx({
      pages: [page("a11y", "a11y/contrast", "p.old"), page("a11y", "a11y/contrast", "p.new")],
      modes: { a11y: "active" },
      baseline,
      now,
      muted: () => false,
    });
    assert.deepEqual(
      governed.findings.map((item) => [item.selector, item.blocking, item.baseline === true]),
      [
        ["p.old", false, true],
        ["p.new", true, false],
      ],
    );
  });

  it("shadow never blocks, unverified never blocks, a muted rule never blocks", () => {
    const pages = [page("a11y", "a11y/contrast", "p.new"), page("a11y", "a11y/contrast", "p.hero", true)];
    const shadow = governUx({ pages, modes: { a11y: "shadow" }, baseline, now, muted: () => false });
    assert.ok(shadow.findings.every((item) => !item.blocking));
    const active = governUx({ pages, modes: { a11y: "active" }, baseline, now, muted: () => false });
    assert.deepEqual(
      active.findings.map((item) => item.blocking),
      [true, false],
    );
    const muted = governUx({ pages, modes: { a11y: "active" }, baseline, now, muted: () => true });
    assert.ok(muted.findings.every((item) => !item.blocking));
  });

  it("a fixed violation lowers the baseline for a route that was captured", () => {
    const governed = governUx({
      pages: [page("a11y", "a11y/contrast", "p.new")],
      modes: { a11y: "active" },
      baseline,
      now,
      muted: () => false,
    });
    assert.deepEqual(governed.fixed?.entries, []);
  });
});

const PLANTED = [
  "<main>",
  '<p style="color:#999">faint text</p>',
  '<div><button style="width:16px;height:16px;padding:0;border:0">s</button><button style="width:80px;height:40px;margin:0">Next</button></div>',
  '<div style="width:350px">wide row</div>',
  '<div style="width:80px;overflow:hidden;white-space:nowrap">a sentence that is cut</div>',
  '<button style="width:48px;height:48px"></button>',
  "<input>",
  '<p style="background:linear-gradient(#000,#333);color:#fff">over gradient</p>',
  '<span data-axe="1">aria</span>',
  "</main>",
].join("");

const CLEAN = [
  "<main>",
  '<p style="color:#333">clear text</p>',
  '<div><button style="width:48px;height:48px">s</button><button style="width:80px;height:48px;margin:0 0 0 8px">Next</button></div>',
  '<div style="width:300px">narrow row</div>',
  '<div style="width:300px">a sentence that fits</div>',
  '<button style="width:48px;height:48px">Go</button>',
  "<label>Email <input></label>",
  '<p style="background:#000;color:#fff">dark block</p>',
  "</main>",
].join("");

const FAKE_AXE = [
  "window.axe = { run: async () => ({ violations: [...document.querySelectorAll('[data-axe]')].map(() => (",
  "  { id: 'aria-allowed-role', help: 'role not allowed', nodes: [{ target: ['[data-axe]'] }] })) }) };",
  "",
].join("\n");

describe("a11y: planted fixture against a clean twin", () => {
  it("one finding per planted violation, none on the clean twin, no aggregate score anywhere", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(
      { "/planted": PLANTED, "/clean": CLEAN },
      {
        routes: ["/planted", "/clean"],
        files: {
          "node_modules/axe-core/package.json": JSON.stringify({ name: "axe-core", main: "axe.js" }),
          "node_modules/axe-core/axe.js": FAKE_AXE,
        },
      },
    );
    repos.push(repo);
    const run = await lookAt(repo);
    const at = (route: string, viewport: number) =>
      run.summary.findings
        .filter((item) => item.feature === "a11y" && item.route === route && item.viewport === viewport)
        .map((item) => (item.unverified === true ? `${item.rule}?` : item.rule))
        .sort();
    assert.deepEqual(at("/planted", 390), [
      "a11y/clipped-text",
      "a11y/contrast",
      "a11y/contrast?",
      "a11y/engine",
      "a11y/label",
      "a11y/name",
      "a11y/target-size",
    ]);
    assert.ok(at("/planted", 320).includes("a11y/reflow"));
    for (const width of [320, 390, 768, 1440]) assert.deepEqual(at("/clean", width), []);
    assert.ok(run.summary.findings.every((item) => item.feature !== "a11y" || !item.blocking));
    const dir = join(repo.root, ".finitemonkey", "look", run.summary.treeHash);
    const ux = readFileSync(join(dir, "ux.json"), "utf8");
    assert.ok(!/score/i.test(ux));
    assert.ok(!/score/i.test(readFileSync(join(dir, "summary.json"), "utf8")));
    assert.ok(existsSync(join(dir, "planted-390.a11y.png")));
    assert.ok(!readdirSync(dir).includes("clean-390.a11y.png"));
  });

  it("active mode blocks the new violation, and accepting it into the baseline releases it", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(
      { "/": '<main><p style="color:#aaa">faint</p></main>' },
      { routes: ["/"], policy: "guards:\n  a11y: active\n" },
    );
    repos.push(repo);
    const first = await lookAt(repo);
    const blocking = first.summary.findings.filter((item) => item.blocking && item.rule === "a11y/contrast");
    assert.equal(blocking.length, 4);
    const runtime = repoRuntime();
    saveBaseline(runtime, repo.root, {
      ...EMPTY_BASELINE,
      entries: blocking.map((item) => ({
        check: "a11y",
        id: item.id ?? "",
        rule: item.rule,
        file: item.route,
        line: item.viewport,
        fingerprint: `${String(item.viewport)} ${item.selector ?? ""}`,
        state: "aceito" as const,
        owner: "p",
        reason: "known",
        acceptedAt: new Date().toISOString(),
        expiresAt: "2099-01-01T00:00:00.000Z",
      })),
    });
    const second = await lookAt(repo);
    assert.ok(!second.summary.findings.some((item) => item.blocking));
  });
});
