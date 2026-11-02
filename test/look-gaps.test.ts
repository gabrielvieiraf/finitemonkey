import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

import { parseLookConfig } from "../src/look/config.js";
import { renderedCopy, renderedCopyIssues } from "../src/look/copy-rendered.js";
import { formChoices, formFields, type StepEntry } from "../src/look/forms-dom.js";
import { redundantEntry, type StepDriver, type StepSnapshot } from "../src/look/forms-steps.js";
import { keyboardIssues } from "../src/look/keyboard.js";
import {
  COMPOSITES,
  type FocusStop,
  type FocusTarget,
  focusTargets,
  sharedContainer,
} from "../src/look/keyboard-dom.js";
import { type KeyDriver, walkKeyboard } from "../src/look/keyboard-walk.js";
import { runInPage } from "../src/look/probe-dom.js";
import { skeletonIssues } from "../src/look/states.js";
import { LIVE_SELECTOR, shimmerBlocks } from "../src/look/states-dom.js";
import { el, fakeDom, kit } from "./fake-dom.js";

interface PageModel {
  readonly order: readonly string[];
  readonly back?: readonly string[];
  readonly arrows?: Readonly<Record<string, string>>;
  readonly containers?: Readonly<Record<string, string>>;
  readonly targets: (composites: readonly string[]) => readonly FocusTarget[];
}

const stopOf = (sel: string, index: number): FocusStop => ({
  sel,
  role: "button",
  name: sel,
  x: 0,
  y: index * 40,
  w: 80,
  h: 30,
  obscured: false,
  composite: null,
  modal: false,
});

const fakeKeys = (model: PageModel): KeyDriver => {
  let current: string | undefined;
  const back = model.back ?? [...model.order].reverse();
  const after = (list: readonly string[], sel: string | undefined): string | undefined =>
    sel === undefined ? list[0] : list[list.indexOf(sel) + 1];
  return {
    press: async (key) => {
      if (key === "Tab") current = after(model.order, current);
      else if (key === "Shift+Tab") current = current === undefined ? undefined : after(back, current);
      else if (current !== undefined) current = model.arrows?.[current] ?? current;
      await Promise.resolve();
    },
    focused: async () =>
      Promise.resolve(current === undefined ? undefined : stopOf(current, model.order.indexOf(current))),
    focus: async (sel) => {
      current = sel;
      await Promise.resolve();
    },
    reset: async () => {
      current = undefined;
      await Promise.resolve();
    },
    shows: async () => Promise.resolve(true),
    container: async (from, to) => Promise.resolve(model.containers?.[`${from} ${to}`] ?? null),
    targets: async (composites) => Promise.resolve(model.targets(composites)),
  };
};

const rules = (found: readonly { readonly rule: string; readonly selector: string }[]) =>
  found.map((item) => `${item.rule} ${item.selector}`);

describe("keyboard: full reverse Tab walk", () => {
  const targets = () => ["#a", "#b", "#c"].map((sel) => ({ sel, composite: null }));

  it("a reverse order that differs from Tab yields a finding; the clean twin yields none", async () => {
    const odd = await walkKeyboard(fakeKeys({ order: ["#a", "#b", "#c"], back: ["#c", "#a", "#b"], targets }));
    const found = keyboardIssues(odd.walk, odd.targets, []);
    assert.deepEqual(rules(found), ["keyboard/reverse-order #a"]);
    assert.ok(found.every((item) => item.advisory === true));
    const clean = await walkKeyboard(fakeKeys({ order: ["#a", "#b", "#c"], targets }));
    assert.deepEqual(keyboardIssues(clean.walk, clean.targets, []), []);
  });
});

describe("keyboard: composites by behavior", () => {
  const LIST = "body > main > div";
  const options = ["#opt1", "#opt2", "#opt3"];
  const targets = (composites: readonly string[]) => [
    { sel: "#a", composite: null },
    ...options.map((sel) => ({ sel, composite: composites.includes(LIST) ? LIST : null })),
    { sel: "#b", composite: null },
  ];

  it("a custom listbox without a role but with arrow-key focus is recognized", async () => {
    const page = {
      order: ["#a", "#opt1", "#b"],
      arrows: { "#opt1": "#opt2", "#opt2": "#opt3" },
      containers: { "#opt1 #opt2": LIST },
      targets,
    };
    const { walk, targets: found } = await walkKeyboard(fakeKeys(page));
    assert.equal(walk.stops.find((stop) => stop.sel === "#opt1")?.composite, LIST);
    assert.deepEqual(keyboardIssues(walk, found, []), []);
    const inert = await walkKeyboard(fakeKeys({ order: ["#a", "#opt1", "#b"], targets }));
    assert.deepEqual(rules(keyboardIssues(inert.walk, inert.targets, [])), [
      "keyboard/unreachable #opt2",
      "keyboard/unreachable #opt3",
    ]);
  });

  it("the page side finds the shared container and counts its options as one group", () => {
    const option = (id: string, tabindex: string) => el("div", { attrs: { id, role: "option", tabindex } }, id);
    const { doc, win } = fakeDom([
      el("main", {}, el("div", {}, option("opt1", "0"), option("opt2", "-1"), option("opt3", "-1"))),
    ]);
    const box = sharedContainer(kit, doc, "#opt1", "#opt2");
    assert.equal(box, LIST);
    const grouped = focusTargets(kit, doc, win, [COMPOSITES, LIST].join(", "));
    assert.deepEqual(
      grouped.map((item) => item.composite),
      [LIST, LIST, LIST],
    );
    assert.equal(sharedContainer(kit, doc, "#opt1", "#missing"), null);
  });
});

const entry = (sel: string, overrides: Partial<StepEntry> = {}): StepEntry => ({
  sel,
  type: "text",
  required: true,
  pattern: "",
  min: "",
  max: "",
  minLength: 0,
  labelled: true,
  placeholder: "",
  name: "",
  autocomplete: "",
  label: "",
  value: "",
  ...overrides,
});

const fakeSteps = (pages: Readonly<Record<string, StepSnapshot>>, prefill: boolean): StepDriver => {
  const typed = new Map<string, string>();
  return {
    snapshot: async (step) => {
      const page = pages[step];
      if (page === undefined || !prefill) return Promise.resolve(page);
      const fields = page.fields.map((field) => ({ ...field, value: typed.get(field.type) ?? field.value }));
      return Promise.resolve({ ...page, fields });
    },
    fill: async (sel, value) => {
      const field = Object.values(pages)
        .flatMap((page) => page.fields)
        .find((item) => item.sel === sel);
      if (field !== undefined) typed.set(field.type, value);
      await Promise.resolve();
    },
    submit: async () => Promise.resolve(),
  };
};

describe("forms: redundant entry (WCAG 3.3.7)", () => {
  const pages = {
    "#step1": { fields: [entry("#email", { type: "email", label: "Email" }), entry("#name")], choices: [] },
    "#step2": { fields: [entry("#confirm", { type: "email", label: "Your email" })], choices: [] },
  };

  it("a two-step form asking the email twice is reported; prefilled or offered it is not", async () => {
    const found = await redundantEntry(fakeSteps(pages, false), ["#step1", "#step2"], {});
    assert.deepEqual(rules(found), ["forms/redundant-entry #confirm"]);
    assert.match(found[0]?.detail ?? "", /3\.3\.7.*ana@example\.com.*#email/);
    assert.equal(found[0]?.advisory, true);
    assert.deepEqual(await redundantEntry(fakeSteps(pages, true), ["#step1", "#step2"], {}), []);
    const offered = { ...pages, "#step2": { ...pages["#step2"], choices: ["ana@example.com"] } };
    assert.deepEqual(await redundantEntry(fakeSteps(offered, false), ["#step1", "#step2"], {}), []);
  });

  it("multi-step forms are declared per route in look.yml", () => {
    const config = parseLookConfig('port: 3000\nforms_steps:\n  - "/signup #step1 #step2"\n  - "/signup #lonely"\n');
    assert.deepEqual(config.formSteps, { "/signup": [["#step1", "#step2"]] });
  });

  it("a missing step is not verified rather than passed", async () => {
    const found = await redundantEntry(fakeSteps(pages, false), ["#step1", "#gone"], {});
    assert.deepEqual(
      found.map((item) => [item.rule, item.unverified]),
      [["forms/redundant-entry", true]],
    );
  });

  it("the page side reads names, autocomplete, labels, values and the choices offered", () => {
    const { doc } = fakeDom([
      el(
        "form",
        { attrs: { id: "step2" } },
        el(
          "label",
          {},
          "Email ",
          el("input", { attrs: { id: "e", type: "email", name: "email", autocomplete: "Email" } }),
        ),
        el(
          "select",
          { attrs: { id: "pick" } },
          el("option", { attrs: { value: "ana@example.com" } }, "ana@example.com"),
        ),
      ),
    ]);
    const [field] = formFields(kit, doc, "#step2");
    assert.deepEqual(
      [field?.sel, field?.name, field?.autocomplete, field?.label, field?.value],
      ["#e", "email", "email", "Email", ""],
    );
    assert.ok(formChoices(kit, doc, "#step2").includes("ana@example.com"));
  });
});

describe("rendered copy at 1440", () => {
  it("a rendered button labeled with a noun is reported with its DOM selector and catalog key", () => {
    const { doc, win } = fakeDom([
      el(
        "main",
        {},
        el("button", { attrs: { id: "settings" } }, "Settings"),
        el("button", { attrs: { id: "save" } }, "Save changes"),
        el("a", { attrs: { id: "blank", href: "/x" } }),
        el("p", { attrs: { id: "oops", role: "alert" } }, "Something went wrong"),
        el("button", { attrs: { id: "hidden", "aria-hidden": "true" } }, "Profile"),
      ),
    ]);
    const copy = renderedCopy(kit, doc, win, 200);
    const entries = [
      { file: "src/locales/en.json", lang: "en" as const, key: "nav.settings_button", text: "Settings" },
    ];
    const found = renderedCopyIssues(copy, entries, []);
    assert.deepEqual(rules(found), [
      "ui-copy/verb-first #settings",
      "ui-copy/empty-label #blank",
      "ui-copy/error-action #oops",
    ]);
    assert.match(found[0]?.detail ?? "", /"Settings" \(catalog src\/locales\/en\.json#nav\.settings_button\)/);
    assert.ok(found.every((item) => item.advisory === true));
    assert.deepEqual(rules(renderedCopyIssues(copy, entries, ["Settings", "Something went wrong"])), [
      "ui-copy/empty-label #blank",
    ]);
  });
});

describe("ui-states: unmarked skeletons", () => {
  const shimmer = { "animation-name": "pulse", "background-color": "rgb(230, 230, 230)" };
  const rect = { x: 0, y: 0, width: 240, height: 16 };

  it("a shimmer block with no marker is reported; a marked skeleton is not", () => {
    const { doc, win } = fakeDom([
      el(
        "main",
        {},
        el("div", { attrs: { id: "bare" }, style: shimmer, rect }, el("div", { style: shimmer, rect })),
        el("div", {
          attrs: { id: "after" },
          rect,
          pseudo: { "::after": { "animation-name": "s", "background-image": "linear-gradient(red, blue)" } },
        }),
        el("div", { attrs: { "aria-busy": "true" } }, el("div", { attrs: { id: "busy" }, style: shimmer, rect })),
        el("div", { attrs: { role: "status" } }, el("div", { attrs: { id: "live" }, style: shimmer, rect })),
        el("div", { attrs: { id: "text" }, style: shimmer, rect }, "Loaded"),
        el("div", { attrs: { id: "still" }, style: { "background-color": "rgb(230, 230, 230)" }, rect }),
      ),
    ]);
    const marked = [LIVE_SELECTOR, "[aria-busy=true]"].join(", ");
    const found = skeletonIssues(shimmerBlocks(kit, doc, win, marked));
    assert.deepEqual(rules(found), ["ui-states/unmarked-skeleton #bare", "ui-states/unmarked-skeleton #after"]);
    assert.ok(found.every((item) => item.advisory === true && item.detail.includes("possible unmarked skeleton")));
    const declared = skeletonIssues(shimmerBlocks(kit, doc, win, `${marked}, #bare, #after`));
    assert.deepEqual(declared, []);
  });
});

describe("page scripts carry no module scope", () => {
  it("the serialized skeleton, copy, container and choices scripts run on their own", () => {
    const { doc, win } = fakeDom([
      el(
        "main",
        {},
        el("div", { attrs: { id: "bare" }, style: { "animation-name": "p", "background-color": "red" } }),
        el("button", { attrs: { id: "go" } }, "Settings"),
        el(
          "form",
          { attrs: { id: "f" } },
          el("div", {}, el("input", { attrs: { id: "x", type: "radio", value: "a" } })),
        ),
      ),
    ]);
    const evaluate = (source: string, args: readonly string[]): unknown =>
      JSON.parse(JSON.stringify(runInNewContext(runInPage(source, args), { document: doc, window: win })));
    assert.deepEqual(evaluate(shimmerBlocks.toString(), ["document", "window", JSON.stringify("[role=status]")]), [
      { sel: "#bare", x: 0, y: 0, w: 100, h: 20 },
    ]);
    assert.deepEqual(evaluate(renderedCopy.toString(), ["document", "window", "200"]), {
      lang: "en",
      items: [{ sel: "#go", kind: "button", text: "Settings" }],
    });
    assert.equal(evaluate(sharedContainer.toString(), ["document", '"#go"', '"#bare"']), "body > main");
    assert.deepEqual(evaluate(formChoices.toString(), ["document", '"#f"']), ["a"]);
  });
});
