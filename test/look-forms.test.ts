import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { invalidValue, submitIssues, validValue } from "../src/look/forms.js";
import type { FieldInfo } from "../src/look/forms-dom.js";
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

const field = (overrides: Partial<FieldInfo>): FieldInfo => ({
  sel: "#e",
  type: "email",
  required: true,
  pattern: "",
  min: "",
  max: "",
  minLength: 0,
  labelled: true,
  placeholder: "",
  ...overrides,
});

describe("forms: values from constraints", () => {
  it("derives invalid and valid values, and needs a declared value for a pattern", () => {
    assert.equal(invalidValue(field({})), "not-an-email");
    assert.equal(validValue(field({}), {}), "ana@example.com");
    assert.equal(invalidValue(field({ type: "number", min: "3" })), "2");
    assert.equal(validValue(field({ type: "text", pattern: "[A-Z]{3}" }), {}), undefined);
    assert.equal(validValue(field({ type: "text", pattern: "[A-Z]{3}" }), { "#e": "ABC" }), "ABC");
    assert.equal(invalidValue(field({ type: "text", required: false })), undefined);
  });

  it("a field declared as cleared on purpose is not input loss", () => {
    const target = field({});
    const found = submitIssues({
      target,
      typed: { "#e": "x", "#code": "123456" },
      after: [
        { sel: "#e", value: "x", invalid: true, message: "Enter an email", near: true, focused: true, exists: true },
        { sel: "#code", value: "", invalid: false, message: "", near: false, focused: false, exists: true },
      ],
      corrected: undefined,
      keepCleared: ["#code"],
      native: false,
    });
    assert.deepEqual(found, []);
  });
});

const FORM = (input: string): string =>
  `<main><form id="f" novalidate>${input}<p id="m"></p><label>Name <input id="n"></label><button>Send</button></form>`;

const CLEAN_JS = [
  "const check = () => { const ok = e.checkValidity(); e.setAttribute('aria-invalid', String(!ok)); m.textContent = ok ? '' : 'Enter an email like ana@example.com'; return ok; };",
  "e.addEventListener('blur', () => { if (e.value) check(); });",
  "e.addEventListener('input', () => { if (e.getAttribute('aria-invalid') === 'true') check(); });",
  "f.onsubmit = (ev) => { ev.preventDefault(); if (!check()) e.focus(); };",
].join("");

const LABELLED = '<label>Email <input id="e" type="email" required aria-describedby="m"></label>';

const PAGES = {
  "/clean": `${FORM(LABELLED)}<script>${CLEAN_JS}</script></main>`,
  "/clears": `${FORM(LABELLED)}<script>${[
    "f.onsubmit = (ev) => { ev.preventDefault(); if (!e.checkValidity()) { f.reset(); m.textContent = 'Enter an email'; e.setAttribute('aria-invalid', 'true'); e.focus(); } };",
    "e.addEventListener('input', () => { if (e.checkValidity()) { m.textContent = ''; e.setAttribute('aria-invalid', 'false'); } });",
  ].join("")}</script></main>`,
  "/top": `<div id="banner" role="alert"></div>${FORM('<label>Email <input id="e" type="email" required></label>')}<script>${[
    "f.onsubmit = (ev) => { ev.preventDefault(); if (!e.checkValidity()) { banner.textContent = 'Email is invalid'; e.focus(); } };",
  ].join("")}</script></main>`,
  "/eager": `${FORM(LABELLED)}<script>${[
    "e.oninput = () => { const ok = e.checkValidity(); e.setAttribute('aria-invalid', String(!ok)); m.textContent = ok ? '' : 'Enter a valid email'; };",
    "f.onsubmit = (ev) => { ev.preventDefault(); if (!e.checkValidity()) e.focus(); };",
  ].join("")}</script></main>`,
  "/placeholder": `${FORM('<input id="e" type="email" required placeholder="Email" aria-describedby="m">')}<script>${CLEAN_JS}</script></main>`,
};

describe("forms: fixtures exercised in the browser", () => {
  it("each planted form defect is reported and the clean form yields nothing", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const routes = Object.keys(PAGES);
    const repo = await fixtureRepo(PAGES, {
      routes,
      look: ["forms:", ...routes.map((route) => `  - "${route} #f"`)],
      policy: "guards:\n  a11y: off\n  keyboard: off\n  ui-states: off\n  ds-adherence: off\n  default-look: off\n",
    });
    repos.push(repo);
    const run = await lookAt(repo);
    const rules = (route: string) => [
      ...new Set(
        run.summary.findings
          .filter((item) => item.feature === "ui-forms" && item.route === route)
          .map((item) => item.rule),
      ),
    ];
    assert.deepEqual(rules("/clean"), []);
    assert.deepEqual(rules("/clears"), ["forms/input-lost"]);
    assert.deepEqual(rules("/top"), ["forms/error-not-linked"]);
    assert.deepEqual(rules("/eager"), ["forms/premature"]);
    assert.deepEqual(rules("/placeholder"), ["forms/placeholder-label"]);
  });
});
