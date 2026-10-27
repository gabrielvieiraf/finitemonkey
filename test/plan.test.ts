import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { MASTER_SECTIONS } from "../src/plan/sections.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field, ROOT } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures", "plan");
const NOW = "2026-10-27T12:00:00.000Z";
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const filesOf = (name: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    readdirSync(join(FIXTURES, name)).map((file) => [
      `docs/plan/${file}`,
      readFileSync(join(FIXTURES, name, file), "utf8"),
    ]),
  );

const project = (...layers: readonly string[]): Repo => {
  const files = layers.reduce<Readonly<Record<string, string>>>((all, name) => ({ ...all, ...filesOf(name) }), {
    "README.md": "# app\n",
  });
  const repo = makeRepo(files);
  repos.push(repo);
  return repo;
};

const runtime = () => repoRuntime({ now: () => NOW });

const kinds = async (repo: Repo): Promise<readonly string[]> => {
  const { body } = await cliJson(["plan", "check"], { cwd: repo.root, runtime: runtime() });
  const issues = field(body, "data", "issues");
  return Array.isArray(issues) ? issues.map((item: unknown) => String(field({ item }, "item", "kind"))) : [];
};

const FAILURES: Readonly<Record<string, string>> = {
  "number-without-report": "number_without_report",
  "missing-report": "missing_report",
  "missing-from-index": "not_indexed",
  "decided-twice": "decided_twice",
  "two-owners": "two_owners",
  "no-owner": "no_owner",
  "revoked-without-banner": "revoked_without_banner",
  order: "order",
};

describe("finitemonkey plan check", () => {
  it("passes the valid fixture, revoked report with its banner included", async () => {
    const { code, body } = await cliJson(["plan", "check"], { cwd: project("valid").root, runtime: runtime() });
    assert.equal(code, 0);
    assert.equal(field(body, "data", "reports"), 3);
  });

  for (const [fixture, kind] of Object.entries(FAILURES)) {
    it(`fails on ${fixture}`, async () => {
      const repo = project("valid", fixture);
      assert.deepEqual(await kinds(repo), [kind]);
      const human = await cli(["plan", "check"], { cwd: repo.root, runtime: runtime() });
      assert.equal(human.code, 1);
      assert.match(human.stdout + human.stderr, /docs\/plan|MASTER\.md|\.md:\d+/);
    });
  }

  it("fails when the master plan grew without saving the previous version", async () => {
    const repo = project("valid");
    repo.write(
      "docs/plan/MASTER.md",
      `${repo.read("docs/plan/MASTER.md")}- Refunds within 2 days (01a-today-billing.md)\n`,
    );
    assert.deepEqual(await kinds(repo), ["grew_without_previous"]);
  });

  it("finds every contradiction planted in one example project", async () => {
    const repo = project(...Object.keys(FAILURES).filter((name) => name !== "order"), "valid");
    repo.write(
      "docs/plan/MASTER.md",
      readFileSync(join(FIXTURES, "valid", "MASTER.md"), "utf8")
        .replace("| Refunds | Ana |", "| Refunds | Ana, Bruno |")
        .replace("| Chargebacks | Bruno |", "| Chargebacks | |")
        .replace("## Risks", "- Refund window of 7 days\n- Retry 5 times (09-research-retries.md)\n\n## Risks")
        .concat("- 04-decision-provider-again.md\n"),
    );
    repo.write(
      "docs/plan/03-decision-webhooks.md",
      readFileSync(join(FIXTURES, "revoked-without-banner", "03-decision-webhooks.md"), "utf8"),
    );
    assert.deepEqual([...new Set(await kinds(repo))].sort(), [
      "decided_twice",
      "grew_without_previous",
      "missing_report",
      "no_owner",
      "not_indexed",
      "number_without_report",
      "revoked_without_banner",
      "two_owners",
    ]);
  });
});

describe("finitemonkey plan init and consolidate", () => {
  it("creates the master plan in the fixed section order on the first L task", async () => {
    const repo = project();
    const small = await cliJson(["task", "new", "s1", "--goal", "small"], { cwd: repo.root, runtime: runtime() });
    assert.equal(small.code, 0);
    assert.throws(() => repo.read("docs/plan/MASTER.md"));
    await cliJson(["task", "new", "l1", "--goal", "replace billing", "--size", "L"], {
      cwd: repo.root,
      runtime: runtime(),
    });
    const headings = repo
      .read("docs/plan/MASTER.md")
      .split("\n")
      .filter((line) => line.startsWith("## "));
    assert.deepEqual(headings, [
      "## Goal",
      "## Decisions",
      "## Responsibilities",
      "## Numbers",
      "## Risks",
      "## Open questions",
      "## Reports",
    ]);
    assert.equal(headings.length, MASTER_SECTIONS.length);
    assert.equal((await cliJson(["plan", "check"], { cwd: repo.root, runtime: runtime() })).code, 0);
    const again = await cliJson(["plan", "init"], { cwd: repo.root, runtime: runtime() });
    assert.equal(field(again.body, "data", "created"), false);
  });

  it("keeps MASTER-previous-YYYY-MM-DD.md, lists the new report text and shows the diff", async () => {
    const repo = project("valid", "missing-from-index");
    const before = repo.read("docs/plan/MASTER.md");
    const started = await cliJson(["plan", "consolidate"], { cwd: repo.root, runtime: runtime() });
    assert.equal(started.code, 0);
    assert.equal(field(started.body, "data", "previous"), "docs/plan/MASTER-previous-2026-10-27.md");
    assert.equal(repo.read("docs/plan/MASTER-previous-2026-10-27.md"), before);
    assert.deepEqual(field(started.body, "data", "reports"), [
      { file: "docs/plan/04-research-retries.md", text: "- Retry webhooks with backoff (04-research-retries.md)" },
    ]);
    assert.equal(started.body["next"], "finitemonkey plan consolidate --done");
    repo.write(
      "docs/plan/MASTER.md",
      before
        .replace("## Risks", "- Retry webhooks with backoff, 3 tries (04-research-retries.md)\n\n## Risks")
        .concat("- 04-research-retries.md\n"),
    );
    const done = await cli(["plan", "consolidate", "--done"], { cwd: repo.root, runtime: runtime() });
    assert.equal(done.code, 0, done.stderr);
    assert.match(done.stdout, /\+- Retry webhooks with backoff, 3 tries/);
    assert.deepEqual(await kinds(repo), []);
  });
});
