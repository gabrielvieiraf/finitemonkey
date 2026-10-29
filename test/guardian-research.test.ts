import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { readResearchLog, researchState } from "../src/research/log.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const QUESTION = "which provider settles Pix fastest";
const SLUG = "which-provider-settles-pix-fastest";

const start = async (extra: readonly string[] = []): Promise<Repo> => {
  const repo = makeRepo({ "docs/plan/02-decision-provider.md": "# Decision: provider\n" });
  repos.push(repo);
  const run = await cli(
    [
      "research",
      "new",
      QUESTION,
      "--decision",
      "docs/plan/02-decision-provider.md",
      "--option",
      "Asaas",
      "--option",
      "Stripe",
      "--criterion",
      "settlement time",
      "--stop",
      "two providers compared on settlement",
      ...extra,
    ],
    { cwd: repo.root, runtime: repoRuntime() },
  );
  assert.equal(run.code, 0, run.stdout + run.stderr);
  return repo;
};

const source = (repo: Repo, url: string, changed: string, more: readonly string[] = []) =>
  cliJson(["research", "source", SLUG, url, "--changed", changed, ...more], { cwd: repo.root, runtime: repoRuntime() });

describe("research with a question, a decision and a stop rule", () => {
  it("links the research log to the decision record", async () => {
    const repo = await start();
    const log = readResearchLog(repoRuntime(), fmPaths(repo.root), SLUG);
    assert.ok(log !== undefined);
    assert.equal(log.question.decision, "docs/plan/02-decision-provider.md");
    assert.deepEqual(log.question.options, ["Asaas", "Stripe"]);
    const missing = await cli(["research", "new", "another question", "--decision", "docs/plan/09-decision-x.md"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.notEqual(missing.code, 0);
  });

  it("two sources in a row that change nothing get the stop note", async () => {
    const repo = await start();
    await source(repo, "https://docs.asaas.com/pix", "option", ["--target", "Asaas"]);
    const quiet = await source(repo, "https://blog.example.com/pix", "nothing");
    assert.equal(field(quiet.body, "data", "state", "suggestStop"), false);
    const second = await source(repo, "https://forum.example.org/pix", "nothing");
    assert.equal(field(second.body, "data", "state", "suggestStop"), true);
    const shown = await cli(["research", "status", SLUG], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(shown.stdout, /Propose stopping here or switching focus/);
  });

  it("an open critical unknown suppresses the note, and a high-risk one needs two independent sources", async () => {
    const repo = await start(["--unknown", "chargeback window", "--risk", "high"]);
    await source(repo, "https://a.example.com/x", "nothing");
    const held = await source(repo, "https://b.example.com/y", "nothing");
    assert.equal(field(held.body, "data", "state", "suggestStop"), false);
    await source(repo, "https://docs.asaas.com/chargeback", "unknown", ["--resolves", "chargeback window"]);
    const log = readResearchLog(repoRuntime(), fmPaths(repo.root), SLUG);
    assert.ok(log !== undefined);
    assert.deepEqual(researchState(log).openUnknowns, ["chargeback window"]);
    await source(repo, "https://stripe.com/docs/disputes", "unknown", ["--resolves", "chargeback window"]);
    await source(repo, "https://c.example.com/z", "nothing");
    const done = await source(repo, "https://d.example.com/w", "nothing");
    assert.equal(field(done.body, "data", "state", "suggestStop"), true);
  });
});
