import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { appendResearch, readResearchLog } from "../src/research/log.js";
import { sidesOf, suggestStance } from "../src/research/sides.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const QUESTION = "is the reduced VAT rate allowed for e-books";
const SLUG = "is-the-reduced-vat-rate-allowed-for-e-books";
const UNKNOWN = "whether e-books count as books";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const start = async (): Promise<Repo> => {
  const repo = makeRepo({
    "docs/plan/03-decision-vat.md": "# Decision: VAT rate\n",
    ".finitemonkey/policy.yml": "guards:\n  research-sides: active\n",
  });
  repos.push(repo);
  const opened = await cli(
    [
      "research",
      "new",
      QUESTION,
      "--decision",
      "docs/plan/03-decision-vat.md",
      "--option",
      "reduced",
      "--unknown",
      UNKNOWN,
    ],
    { cwd: repo.root, runtime: repoRuntime() },
  );
  assert.equal(opened.code, 0, opened.stdout + opened.stderr);
  return repo;
};

const run = (repo: Repo, args: readonly string[], person = false) =>
  cliJson(args, { cwd: repo.root, runtime: repoRuntime(), ...(person ? { stdin: tty() } : {}) });

const favoring = (repo: Repo, url: string, person = true) =>
  run(
    repo,
    ["research", "source", SLUG, url, "--changed", "unknown", "--resolves", UNKNOWN, "--stance", "favors"],
    person,
  );

describe("research with a source for and a source against", () => {
  it("a critical unknown backed by one side only cannot close", async () => {
    const repo = await start();
    await favoring(repo, "https://eur-lex.europa.eu/eli/dir/2022/542");
    const closed = await run(repo, ["research", "close", SLUG]);
    assert.notEqual(closed.code, 0);
    assert.match(String(field(closed.body, "error", "message")), /whether e-books count as books/);
  });

  it("a logged empty contrary search allows closing and is shown in the record", async () => {
    const repo = await start();
    await favoring(repo, "https://eur-lex.europa.eu/eli/dir/2022/542");
    const logged = await run(repo, [
      "research",
      "empty",
      SLUG,
      "--unknown",
      UNKNOWN,
      "--query",
      "e-books excluded reduced rate",
      "--place",
      "eur-lex.europa.eu",
    ]);
    assert.equal(logged.code, 0, logged.stdout);
    const closed = await run(repo, ["research", "close", SLUG]);
    assert.equal(closed.code, 0, closed.stdout);
    const log = readResearchLog(repoRuntime(), fmPaths(repo.root), SLUG);
    assert.equal(log?.emptySearches[0]?.queries[0], "e-books excluded reduced rate");
    assert.equal(sidesOf(log).filter((sides) => sides.emptySearch).length, 1);
    assert.ok(log.closedAt !== undefined);
  });

  it("a model-proposed stance stays suggested until the person confirms it", async () => {
    const repo = await start();
    const contest = "https://taxation.example.eu/ebooks-standard-rate";
    const proposed = suggestStance(() => "contests", contest, UNKNOWN);
    assert.equal(proposed, "contests");
    appendResearch(repoRuntime(), fmPaths(repo.root), SLUG, {
      type: "source",
      url: contest,
      changed: "unknown",
      resolves: UNKNOWN,
      stance: proposed,
      stanceBy: "model",
      at: "2026-10-29T12:00:00.000Z",
    });
    await favoring(repo, "https://eur-lex.europa.eu/eli/dir/2022/542");
    const status = await run(repo, ["research", "status", SLUG]);
    const sides = field(status.body, "data", "sides");
    const first: unknown = Array.isArray(sides) ? sides[0] : undefined;
    assert.deepEqual(field(first, "suggested"), [contest]);
    assert.deepEqual(field(first, "contests"), []);
    assert.notEqual((await run(repo, ["research", "close", SLUG])).code, 0);
    const agent = await run(repo, ["research", "stance", SLUG, contest, "--stance", "contests"]);
    assert.notEqual(agent.code, 0);
    const person = await run(repo, ["research", "stance", SLUG, contest, "--stance", "contests"], true);
    assert.equal(person.code, 0, person.stdout);
    assert.equal((await run(repo, ["research", "close", SLUG])).code, 0);
  });

  it("the research record links its sources' claims and the decision record", async () => {
    const repo = await start();
    repo.write(
      ".finitemonkey/decision-records/t.json",
      `${JSON.stringify({ schema: "finitemonkey/decision-record@1", task: "t", at: "2026-10-29T12:00:00.000Z", research: [SLUG], changes: [], paths: [] })}\n`,
    );
    await run(
      repo,
      ["research", "source", SLUG, "https://eur-lex.europa.eu/x", "--changed", "unknown", "--claim", "j-0123456789"],
      true,
    );
    const status = await run(repo, ["research", "status", SLUG]);
    assert.deepEqual(field(status.body, "data", "claims"), ["j-0123456789"]);
    assert.deepEqual(field(status.body, "data", "decisionRecords"), ["t"]);
    assert.equal(field(status.body, "data", "decision"), "docs/plan/03-decision-vat.md");
  });
});
