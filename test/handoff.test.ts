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
});
