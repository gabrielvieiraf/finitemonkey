import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { runGate } from "../src/gate/run.js";
import { citedQuotes, quoteIn, resolveCited } from "../src/quotes/spans.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const SOURCE = "# Trial\n\nIn 120 adults, the mean number of migraine days fell from 6.1 to 5.4 per month.\n";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const repoWith = (answer: string): Repo => {
  const repo = makeRepo({ "sources/trial.md": SOURCE, "README.md": "Research desk\n" });
  repos.push(repo);
  repo.write("answer.md", answer);
  return repo;
};

const quotesItem = (repo: Repo) => {
  const run = runGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
  });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  return run.report.items.find((item) => item.id === "quotes");
};

describe("cited quotes", () => {
  it("finds a quote followed by the file it cites, in parentheses, brackets or a link", () => {
    const text = [
      'It "fell from 6.1 to 5.4 per month" (sources/trial.md).',
      'Also "the mean number of migraine days" [sources/trial.md:3].',
      'And "In 120 adults, the mean number" ([trial](sources/trial.md)).',
      'Not "a quote with a web source here" (https://example.com/a.md).',
      'Too "short" (sources/trial.md).',
    ].join("\n");
    assert.deepEqual(
      citedQuotes(text).map((quote) => [quote.line, quote.cited]),
      [
        [1, "sources/trial.md"],
        [2, "sources/trial.md"],
        [3, "sources/trial.md"],
      ],
    );
  });

  it("matches word for word across whitespace, case, smart quotes and an ellipsis", () => {
    assert.equal(quoteIn("the MEAN number of   migraine days", SOURCE), true);
    assert.equal(quoteIn("In 120 adults … fell from 6.1 to 5.4", SOURCE), true);
    assert.equal(quoteIn("fell from 6.1 to 4.0 per month", SOURCE), false);
    assert.equal(quoteIn("fell from 6.1 to 5.4 … In 120 adults", SOURCE), false);
  });

  it("resolves the citation from the repository root and from the citing file", () => {
    assert.deepEqual(resolveCited("docs/answer.md", "../sources/trial.md"), ["sources/trial.md"]);
    assert.deepEqual(resolveCited("docs/answer.md", "notes.md"), ["notes.md", "docs/notes.md"]);
    assert.deepEqual(resolveCited("answer.md", "../../etc/passwd.md"), []);
  });

  it("fails the gate when a changed Markdown file misquotes a file in the repository", () => {
    const repo = repoWith('Bottom line: yes.\n\n"cuts migraine days in half" (sources/trial.md)\n');
    const item = quotesItem(repo);
    assert.equal(item?.status, "failed");
    assert.match(JSON.stringify(item), /answer\.md:3/);
  });

  it("passes when every cited quote is in its source, and ignores quotes cited to files that do not exist", () => {
    const repo = repoWith(
      'Bottom line: a small effect.\n\n"fell from 6.1 to 5.4 per month" (sources/trial.md)\n"a quote from elsewhere entirely" (sources/missing.md)\n',
    );
    assert.equal(quotesItem(repo)?.status, "passed");
  });
});
