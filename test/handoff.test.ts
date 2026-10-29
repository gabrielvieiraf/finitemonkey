import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { PASSING_TEST } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const PASSING_TEST_FILES = { "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST };

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

describe("finitemonkey handoff", () => {
  it("builds the brief from the ledger: contract hash and attempts that failed", async () => {
    const repo = makeRepo(PASSING_TEST_FILES);
    repos.push(repo);
    await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    const error = (turn: number): string =>
      JSON.stringify({
        at: `2026-10-29T10:0${String(turn)}:00Z`,
        session: "s1",
        turn,
        kind: "error",
        sig: "abc123",
        sample: "tsc TS2345 in src/a.ts",
        tool: "Bash",
      });
    repo.write(".finitemonkey/signals.jsonl", `${error(1)}\n${error(2)}\n`);
    const { code, body } = await cliJson(["handoff"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(code, 0);
    const hash = String(field(body, "data", "contract", "hash"));
    const text = String(field(body, "data", "text"));
    assert.match(hash, /^[0-9a-f]{8,}$/);
    assert.ok(text.includes(hash), text);
    assert.match(text, /Tried and failed 2 times: tsc TS2345 in src\/a\.ts/);
    assert.match(text, /Not verified: tests/);
  });

  it("lists the open assumptions of the guardian register, highest impact first", async () => {
    const repo = makeRepo(PASSING_TEST_FILES);
    repos.push(repo);
    const line = (id: string, text: string, impact: string, status: string): string =>
      JSON.stringify({
        id,
        text,
        source: "person",
        impact,
        breaks: "refunds",
        confidence: "medium",
        verify: `check ${id}`,
        status,
        at: "2026-10-29T10:00:00Z",
      });
    repo.write(
      ".finitemonkey/assumptions.jsonl",
      [
        line("A1", "the gateway retries webhooks", "low", "unverified"),
        line("A2", "refunds never exceed the charge", "high", "review"),
        line("A3", "orders have one currency", "high", "verified"),
      ].join("\n") + "\n",
    );
    const { body } = await cliJson(["handoff"], { cwd: repo.root, runtime: repoRuntime() });
    const text = String(field(body, "data", "text"));
    assert.match(text, /Open assumption A2 \(high impact\): refunds never exceed the charge; verify: check A2\n.*A1/);
    assert.doesNotMatch(text, /A3/);
  });
});
