import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { copyCheck } from "../src/gate/checks/copy.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { type CopyLedger, rateOf, ruleActive, updateLedger } from "../src/look/copy-ledger.js";
import { bindingKeys, oneNameFindings } from "../src/look/copy-names.js";
import {
  BUTTON_KEYS,
  catalogEntries,
  type CopyOptions,
  ERROR_KEYS,
  labelFindings,
  startsWithVerb,
} from "../src/look/copy-rules.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const OPTIONS: CopyOptions = { allow: ["OK"], buttonKeys: BUTTON_KEYS, errorKeys: ERROR_KEYS };

const EN = JSON.stringify({
  orders: {
    button: { save: "Save order", details: "Order details", ok: "OK" },
    error: { load: "Something went wrong.", network: "Connection lost. Try again in a minute." },
  },
});

const rules = (items: readonly { readonly rule: string; readonly key: string }[]): readonly string[] =>
  items.map((item) => `${item.rule} ${item.key}`);

describe("copy rules on catalogs", () => {
  it("reports a noun button and an error without an action, and spares the allowlist", () => {
    const found = labelFindings(catalogEntries("src/locales/en.json", EN), OPTIONS);
    assert.deepEqual(rules(found), ["verb-first orders.button.details", "error-action orders.error.load"]);
  });

  it("reads verbs per language", () => {
    assert.ok(startsWithVerb("Salvar pedido", "pt"));
    assert.ok(!startsWithVerb("Detalhes do pedido", "pt"));
    assert.ok(startsWithVerb("Guardar pedido", "es"));
    assert.ok(!startsWithVerb("More", "en"));
    const pt = catalogEntries("src/locales/pt-BR.json", JSON.stringify({ error: { load: "Falhou. Tente de novo." } }));
    assert.deepEqual(labelFindings(pt, OPTIONS), []);
  });

  it("reports two labels bound to the same API operation together", () => {
    const entries = catalogEntries(
      "src/locales/en.json",
      JSON.stringify({ cart: { button: { buy: "Place order", checkout: "Buy now" } } }),
    );
    const sources = [
      { file: "src/Cart.tsx", text: '<button onClick={() => api.createOrder()}>\n  {t("cart.button.buy")}\n</button>' },
      { file: "src/Summary.tsx", text: 'const go = () => createOrder(cart);\n<a>{t("cart.button.checkout")}</a>' },
    ];
    const found = oneNameFindings(bindingKeys(sources, ["createOrder"]), entries, []);
    assert.deepEqual(
      found.map((item) => [item.detail, item.key]),
      [["operation createOrder", "cart.button.buy, cart.button.checkout"]],
    );
  });
});

const empty: CopyLedger = {
  "verb-first": { shown: {}, accepted: [] },
  "error-action": { shown: {}, accepted: [] },
  "one-name": { shown: {}, accepted: [] },
  "empty-label": { shown: {}, accepted: [] },
};

describe("copy rule acceptance", () => {
  it("counts a shown finding as accepted once its text changes and the rule no longer fires", () => {
    const shown = labelFindings(catalogEntries("en.json", EN), OPTIONS);
    const first = updateLedger(empty, shown, () => undefined);
    assert.deepEqual(rateOf(first["verb-first"]), { shown: 1, accepted: 0 });
    const fixed = updateLedger(first, [], (_rule, id) => (id === "en.json#orders.button.details" ? "View" : undefined));
    assert.deepEqual(rateOf(fixed["verb-first"]), { shown: 1, accepted: 1 });
    assert.deepEqual(rateOf(fixed["error-action"]), { shown: 1, accepted: 0 });
  });

  it("stays in shadow until the configured threshold and minimum are met", () => {
    assert.equal(ruleActive({ shown: 20, accepted: 20 }, undefined, 10), false);
    assert.equal(ruleActive({ shown: 5, accepted: 5 }, 0.8, 10), false);
    assert.equal(ruleActive({ shown: 10, accepted: 7 }, 0.8, 10), false);
    assert.equal(ruleActive({ shown: 10, accepted: 8 }, 0.8, 10), true);
  });
});

const context = (repo: Repo): GateContext => {
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "copy",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [],
    tests: undefined,
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(ready.kind);
  return ready.prepared.ctx;
};

const CHECK = { id: "copy", kind: "copy" as const };

describe("gate copy check with ui-copy", () => {
  it("lists findings in shadow without failing, even with ui-copy active below the threshold", () => {
    const repo = makeRepo({
      "src/locales/en.json": EN,
      ".finitemonkey/policy.yml": "guards:\n  ui-copy: active\n",
      ".finitemonkey/config.yml": "ui:\n  copy:\n    allow:\n      - OK\n    accept_threshold: 0.8\n",
    });
    repos.push(repo);
    const outcome = copyCheck(CHECK, context(repo));
    assert.equal(outcome.status, "passed");
    const keys = outcome.notes.map((item) => item.key);
    assert.ok(keys.includes("gate.copy.rules_shadow"));
    assert.ok(keys.includes("gate.copy.rule.verb-first"));
    assert.ok(keys.includes("gate.copy.rule.error-action"));
  });

  it("blocks a rule once its fixed-over-shown rate reaches the threshold", () => {
    const repo = makeRepo({
      "src/locales/en.json": EN,
      ".finitemonkey/policy.yml": "guards:\n  ui-copy: active\n",
      ".finitemonkey/config.yml": "ui:\n  copy:\n    allow:\n      - OK\n    accept_threshold: 0.5\n    min_shown: 1\n",
    });
    repos.push(repo);
    const ctx = context(repo);
    copyCheck(CHECK, ctx);
    repo.write(
      "src/locales/en.json",
      EN.replace("Order details", "View details").replace("Something went wrong.", "It failed."),
    );
    repo.write("src/locales/es.json", JSON.stringify({ menu: { button: { more: "Más" } } }));
    const outcome = copyCheck(CHECK, ctx);
    assert.equal(outcome.status, "failed");
    assert.ok(outcome.notes.some((item) => item.key === "gate.copy.rule.verb-first" && item.params["text"] === "Más"));
  });
});
