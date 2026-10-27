import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { appendEvidence } from "../src/evidence/ledger.js";
import { type Evidence, EVIDENCE_SCHEMA } from "../src/evidence/types.js";
import { gitAt, treeHash } from "../src/gate/git.js";
import { LANGUAGES } from "../src/i18n/languages.js";
import { createTranslator } from "../src/i18n/translate.js";
import { BLUEPRINTS, LANDING_IDS, SAAS_IDS } from "../src/planta/blueprints.js";
import { evaluateBlueprint } from "../src/planta/evaluate.js";
import { BLUEPRINT_TEXT } from "../src/planta/text/index.js";
import { BLUEPRINT_TYPES } from "../src/planta/types.js";
import type { ProjectView } from "../src/planta/view.js";
import { segmentText } from "../src/statusline/render.js";
import { loadTask } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { CHECK_KINDS } from "../src/task/types.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const repo = (files: Readonly<Record<string, string>>): Repo => {
  const made = makeRepo(files);
  repos.push(made);
  return made;
};

const SCREENS = {
  "index.html":
    '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Invoices</h1></body></html>\n',
  "style.css": "h1 { color: #333; }\n",
  "src/App.tsx": "export const App = () => <main><h1>Invoices</h1></main>;\n",
};

const green = (body: Readonly<Record<string, unknown>>): unknown => field(body, "data", "green");

describe("planta: blueprints in three languages", () => {
  it("every SaaS and landing item has a title, a reason and a minimum in en, pt-BR and es", () => {
    for (const lang of LANGUAGES) {
      for (const id of [...SAAS_IDS, ...LANDING_IDS]) {
        const text = BLUEPRINT_TEXT[lang][id];
        assert.ok(text.title !== "" && text.why !== "" && text.minimum !== "", `${lang} ${id}`);
      }
    }
    const translated = [...SAAS_IDS, ...LANDING_IDS].filter(
      (id) =>
        BLUEPRINT_TEXT["pt-BR"][id].why !== BLUEPRINT_TEXT.en[id].why &&
        BLUEPRINT_TEXT.es[id].why !== BLUEPRINT_TEXT.en[id].why,
    );
    assert.equal(translated.length, SAAS_IDS.length + LANDING_IDS.length);
    assert.deepEqual(
      BLUEPRINTS.saas.map((item) => item.id),
      [...SAAS_IDS],
    );
    assert.deepEqual(
      BLUEPRINTS.landing.map((item) => item.id),
      [...LANDING_IDS],
    );
  });

  it("the command prints the blueprint in the person's language", async () => {
    const target = repo(SCREENS);
    const pt = await cliJson(["planta", "saas", "--lang", "pt-BR"], { cwd: target.root, runtime: repoRuntime() });
    assert.equal(pt.code, 0, pt.stdout);
    const items = field(pt.body, "data", "items");
    assert.ok(Array.isArray(items));
    assert.equal(field(items[4], "title"), "Banco com migrações");
    const es = await cliJson(["planta", "landing", "--lang", "es"], { cwd: target.root, runtime: repoRuntime() });
    const landing = field(es.body, "data", "items");
    assert.ok(Array.isArray(landing));
    assert.equal(field(landing[3], "title"), "Funciona en el móvil");
  });
});

describe("planta: every item maps to a check or is manual", () => {
  it("probes are files, grep, deps, a contract check kind, or manual", () => {
    const kinds: readonly string[] = CHECK_KINDS;
    for (const type of BLUEPRINT_TYPES) {
      for (const item of BLUEPRINTS[type]) {
        const probe = item.probe;
        assert.ok(["files", "grep", "deps", "contract", "manual"].includes(probe.type), `${type}/${item.id}`);
        if (probe.type === "contract") assert.ok(kinds.includes(probe.kind), probe.kind);
        for (const dependency of item.after) {
          assert.ok(
            BLUEPRINTS[type].some((other) => other.id === dependency),
            `${item.id} after ${dependency}`,
          );
        }
      }
    }
  });

  it("the JSON names the check type and how each item is checked", async () => {
    const target = repo(SCREENS);
    const { body } = await cliJson(["planta", "saas"], { cwd: target.root, runtime: repoRuntime() });
    const items = field(body, "data", "items");
    assert.ok(Array.isArray(items));
    assert.equal(items.length, SAAS_IDS.length);
    for (const item of items) {
      assert.ok(typeof field(item, "check") === "string");
      assert.match(String(field(item, "how")), /^(Checked by|Manual): /);
    }
  });
});

describe("planta: the bar counts only green items for the current tree", () => {
  it("a screens-only project has almost nothing, and a migrations folder adds the database item", async () => {
    const target = repo(SCREENS);
    const runtime = repoRuntime();
    const first = await cliJson(["planta", "saas"], { cwd: target.root, runtime });
    assert.equal(green(first.body), 0);
    assert.match(first.stdout, /"total":25/);
    target.write("migrations/001_invoices.sql", "create table invoices (id serial primary key);\n");
    const second = await cliJson(["planta"], { cwd: target.root, runtime });
    assert.equal(green(second.body), 1);
    const database = field(second.body, "data", "items");
    assert.ok(Array.isArray(database));
    assert.equal(field(database[4], "status"), "green");
  });

  it("a contract check counts only when its evidence is for this tree", async () => {
    const target = repo(SCREENS);
    const runtime = repoRuntime();
    await cliJson(["task", "new", "t1", "--goal", "invoices", "--tests", "node --test"], { cwd: target.root, runtime });
    const paths = fmPaths(target.root);
    const evidence = (tree: string): Evidence => ({
      schema: EVIDENCE_SCHEMA,
      task: "t1",
      check: "tests",
      kind: "tests",
      status: "passed",
      treeHash: tree,
      at: new Date().toISOString(),
      notes: [],
    });
    appendEvidence(runtime, paths.evidence("t1"), [evidence("wold0000000000000")]);
    const stale = await cliJson(["planta", "saas"], { cwd: target.root, runtime });
    assert.equal(green(stale.body), 0);
    appendEvidence(runtime, paths.evidence("t1"), [evidence(treeHash(gitAt(runtime, target.root)) ?? "")]);
    const fresh = await cliJson(["planta"], { cwd: target.root, runtime });
    assert.equal(green(fresh.body), 1);
  });

  it("records the blueprint in the active contract and keeps it trusted", async () => {
    const target = repo(SCREENS);
    const runtime = repoRuntime();
    await cliJson(["task", "new", "t2", "--goal", "invoices"], { cwd: target.root, runtime });
    const installed = await cliJson(["planta", "saas"], { cwd: target.root, runtime });
    assert.equal(field(installed.body, "data", "task"), "t2");
    const files = { disk: () => undefined, base: () => undefined };
    const loaded = loadTask(runtime, fmPaths(target.root), files, "t2");
    assert.ok(loaded.ok);
    assert.equal(loaded.value.contract.blueprint, "saas");
    assert.equal(loaded.value.trusted, true);
    assert.match(target.read(".finitemonkey/tasks/t2.yml"), /^blueprint: saas$/m);
  });

  it("an unknown blueprint is a usage error", async () => {
    const target = repo(SCREENS);
    const { code, body } = await cliJson(["planta", "castle"], { cwd: target.root, runtime: repoRuntime() });
    assert.equal(code, 2);
    assert.equal(field(body, "error", "code"), "invalid_arguments");
  });
});

const view = (greenIds: ReadonlySet<string>): ProjectView => ({
  files: [...(greenIds.has("database") ? ["migrations/1.sql"] : []), ...(greenIds.has("api") ? ["api/x.ts"] : [])],
  grep: () => false,
  manifests: greenIds.has("auth") ? '{"dependencies":{"next-auth":"5"}}' : "",
  passed: () => false,
  tree: "w1",
});

describe("planta: the next item follows real dependencies", () => {
  it("suggests the database before accounts, and accounts before billing", () => {
    const approved = new Set(["problem", "pricing", "backup", "rollback"]);
    const none = evaluateBlueprint("saas", view(new Set(["api"])), approved);
    assert.equal(none.next, "rules");
    const rulesDone = evaluateBlueprint(
      "saas",
      { ...view(new Set(["api"])), files: ["api/x.ts", "docs/plan/a.md"] },
      approved,
    );
    assert.equal(rulesDone.next, "database");
    const withDb = evaluateBlueprint(
      "saas",
      { ...view(new Set(["api", "database"])), files: ["api/x.ts", "docs/plan/a.md", "migrations/1.sql"] },
      approved,
    );
    assert.equal(withDb.next, "auth");
    const withAuth = evaluateBlueprint(
      "saas",
      {
        ...view(new Set(["api", "database", "auth"])),
        files: ["api/x.ts", "docs/plan/a.md", "migrations/1.sql"],
      },
      approved,
    );
    assert.notEqual(withAuth.next, "billing");
    assert.equal(withAuth.items.find((item) => item.id === "billing")?.status, "missing");
  });

  it("the statusline shows the bar", () => {
    const t = createTranslator("en");
    const text = segmentText(t, {
      task: "t1",
      gate: "none",
      contextPercent: undefined,
      blueprint: { type: "saas", green: 3, total: 25 },
    });
    assert.equal(text, "fm · t1 · saas 3/25");
  });
});
