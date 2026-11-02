import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest, ExecResult, Runtime } from "../src/core/runtime.js";
import { parseLookConfig } from "../src/look/config.js";
import { dsIssues } from "../src/look/ds.js";
import { themeTokens, utilityConfigTokens } from "../src/look/ds-config.js";
import type { ProbeNode } from "../src/look/probe.js";
import { EMPTY_TOKENS, loadTokens } from "../src/look/tokens.js";
import { projectTokens } from "../src/look/ux-features.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const THEME = {
  spacing: { "1": "4px", "2": "8px", "4": "16px" },
  borderRadius: { md: "8px" },
  fontSize: { base: ["16px", { lineHeight: "24px" }], sm: "14px" },
  lineHeight: { tight: "1.25" },
  colors: { ink: "#111111", brand: { "500": "#16a34a" }, current: "currentColor" },
  fontFamily: { sans: ["Outfit", "sans-serif"] },
  boxShadow: {},
};

const resolved = (stdout: string, exitCode = 0): ExecResult => ({
  found: true,
  exitCode,
  stdout,
  stderr: exitCode === 0 ? "" : "Cannot find module 'tailwindcss/resolveConfig'",
  timedOut: false,
  durationMs: 1,
});

const fakeNode = (calls: ExecRequest[], stdout = JSON.stringify(THEME), exitCode = 0): Runtime => {
  const base = repoRuntime();
  return {
    ...base,
    exec: (request) => {
      calls.push(request);
      return request.command === "node" ? resolved(stdout, exitCode) : base.exec(request);
    },
  };
};

const node = (overrides: Partial<ProbeNode>): ProbeNode => ({
  parent: -1,
  sel: "div.card",
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
  w: 200,
  h: 40,
  color: "rgb(17, 17, 17)",
  bg: "rgba(0, 0, 0, 0)",
  bgImage: "none",
  opacity: 1,
  fontSize: 16,
  fontWeight: 400,
  fontFamily: "Outfit, sans-serif",
  lineHeight: 0,
  radius: 0,
  shadow: "none",
  borderColor: "rgb(17, 17, 17)",
  borderWidth: 0,
  spacing: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  position: "static",
  zIndex: "auto",
  isolates: false,
  clipped: false,
  live: false,
  ...overrides,
});

const CONFIG = "module.exports = { theme: { spacing: { 1: '4px', 2: '8px', 4: '16px' } } };\n";
const LOOK = (read: boolean): string => `port: 3000\nds:\n  read_config: ${read ? "true" : "false"}\n`;

describe("ds-adherence: utility-CSS config", () => {
  it("a spacing scale in a JS config reports a 13 px padding", () => {
    const repo = makeRepo({ "tailwind.config.js": CONFIG });
    repos.push(repo);
    const calls: ExecRequest[] = [];
    const tokens = projectTokens(fakeNode(calls), repo.root, parseLookConfig(LOOK(true)), []);
    const [call] = calls;
    assert.equal(calls.length, 1);
    assert.equal(call?.command, "node");
    assert.deepEqual(
      calls.map((made) => made.args.slice(-1)),
      [["tailwind.config.js"]],
    );
    assert.deepEqual(tokens.sources, ["tailwind.config.js"]);
    const padded = node({ spacing: [0, 0, 0, 0, 13, 13, 13, 13, 0, 0] });
    const details = dsIssues([padded], tokens, new Set()).issues.map((item) => item.detail);
    assert.ok(details.includes("padding-top 13px is not a token"), details.join("\n"));
    const fine = node({ spacing: [0, 0, 0, 0, 8, 16, 8, 16, 0, 0] });
    assert.deepEqual(dsIssues([fine], tokens, new Set()).issues, []);
  });

  it("with ds.read_config off nothing runs", () => {
    const repo = makeRepo({ "tailwind.config.js": CONFIG });
    repos.push(repo);
    const calls: ExecRequest[] = [];
    const tokens = projectTokens(fakeNode(calls), repo.root, parseLookConfig(LOOK(false)), []);
    assert.equal(calls.length, 0);
    assert.deepEqual(tokens, loadTokens(repoRuntime(), repo.root, []));
    assert.equal(parseLookConfig("port: 3000\n").ds.readConfig, false);
  });

  it("caches the resolved theme by config hash and resolves again when the config changes", () => {
    const repo = makeRepo({ "tailwind.config.js": CONFIG });
    repos.push(repo);
    const calls: ExecRequest[] = [];
    const runtime = fakeNode(calls);
    utilityConfigTokens(runtime, repo.root, undefined);
    utilityConfigTokens(runtime, repo.root, undefined);
    assert.equal(calls.length, 1);
    repo.write("tailwind.config.js", `${CONFIG}// changed\n`);
    utilityConfigTokens(runtime, repo.root, undefined);
    assert.equal(calls.length, 2);
  });

  it("a resolver that fails yields no config tokens and is logged", () => {
    const repo = makeRepo({ "tailwind.config.js": CONFIG });
    repos.push(repo);
    const calls: ExecRequest[] = [];
    assert.equal(utilityConfigTokens(fakeNode(calls, "", 1), repo.root, undefined), undefined);
    assert.ok(repo.read(".finitemonkey/log.jsonl").includes("ds_config_failed"));
  });

  it("maps the resolved theme to the token kinds", () => {
    const tokens = themeTokens(THEME, "tailwind.config.js");
    assert.deepEqual(tokens.lengths, [4, 8, 16]);
    assert.deepEqual(tokens.radii, [8]);
    assert.deepEqual(tokens.fontSizes, [16, 14]);
    assert.deepEqual(tokens.lineHeights, [24]);
    assert.deepEqual(tokens.lineRatios, [1.25]);
    assert.deepEqual(tokens.fonts, ["outfit"]);
    assert.equal(tokens.colors.length, 2);
  });
});

describe("ds-adherence: line-height", () => {
  const tokens = { ...EMPTY_TOKENS, lineHeights: [24], lineRatios: [1.25] };

  it("a line-height outside the tokens is reported", () => {
    const off = node({ text: "Hello", lineHeight: 19 });
    assert.deepEqual(
      dsIssues([off], tokens, new Set()).issues.map((item) => item.detail),
      ["line-height 19px is not a token"],
    );
  });

  it("a line-height on a px token or on a unitless ratio of the font size passes", () => {
    const onPx = node({ text: "Hello", lineHeight: 24 });
    const onRatio = node({ text: "Hello", fontSize: 16, lineHeight: 20 });
    assert.deepEqual(dsIssues([onPx, onRatio], tokens, new Set()).issues, []);
  });

  it("reads line-height tokens from CSS custom properties", () => {
    const repo = makeRepo({ "vars.css": ":root { --leading-body: 1.5; --line-height-title: 32px; --gap: 8px; }\n" });
    repos.push(repo);
    const loaded = loadTokens(repoRuntime(), repo.root, ["vars.css"]);
    assert.deepEqual(loaded.lineRatios, [1.5]);
    assert.deepEqual(loaded.lineHeights, [32]);
    assert.deepEqual(loaded.lengths, [8]);
  });
});
