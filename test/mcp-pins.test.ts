import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { HookOutcome } from "../src/hooks/runner.js";
import { fireHook, policyWith, tty } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, parseBody, ROOT } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const fixture = (name: string): string => readFileSync(join(ROOT, "test", "fixtures", "mcp", name), "utf8");

const setup = (mode: string): Repo => {
  const repo = makeRepo({
    ".finitemonkey/policy.yml": policyWith({ "mcp-pin": mode }),
    "tools-v1.json": fixture("tools-v1.json"),
    "tools-v2.json": fixture("tools-v2.json"),
  });
  repos.push(repo);
  return repo;
};

const pin = (repo: Repo, file: string) =>
  cliJson(["mcp", "pin", "--file", file], { cwd: repo.root, runtime: repoRuntime(), env: { CLAUDECODE: "1" } });

const callSearch = (repo: Repo) =>
  fireHook(repo, "PreToolUse", { tool_name: "mcp__docs__search", tool_input: { query: "billing" } });

const decision = (outcome: HookOutcome): unknown =>
  outcome.stdout.trim() === ""
    ? undefined
    : field(parseBody(outcome.stdout), "hookSpecificOutput", "permissionDecision");

describe("MCP tool descriptions are pinned", () => {
  it("a changed description is reported once and the tool stays untrusted until the person confirms", async () => {
    const repo = setup("active");
    const first = await pin(repo, "tools-v1.json");
    assert.equal(first.code, 0, first.stdout);
    assert.deepEqual(field(first.body, "data", "added"), ["mcp__docs__search", "mcp__tickets__list"]);
    assert.deepEqual(field(first.body, "data", "changed"), []);
    assert.notEqual(decision(await callSearch(repo)), "ask");

    const changed = await pin(repo, "tools-v2.json");
    assert.deepEqual(field(changed.body, "data", "changed"), ["mcp__docs__search"]);
    const again = await pin(repo, "tools-v2.json");
    assert.deepEqual(field(again.body, "data", "changed"), []);
    assert.deepEqual(field(again.body, "data", "pending"), ["mcp__docs__search"]);
    assert.equal(decision(await callSearch(repo)), "ask");

    const byAgent = await cliJson(["mcp", "confirm", "mcp__docs__search"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(byAgent.code, 0);
    assert.equal(decision(await callSearch(repo)), "ask");

    const byPerson = await cliJson(["mcp", "confirm", "mcp__docs__search"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      stdin: tty(),
      env: {},
    });
    assert.equal(byPerson.code, 0, byPerson.stdout);
    assert.notEqual(decision(await callSearch(repo)), "ask");
    assert.deepEqual(field((await pin(repo, "tools-v2.json")).body, "data", "pending"), []);
  });

  it("in shadow a call to a changed tool is logged and not asked", async () => {
    const repo = setup("shadow");
    await pin(repo, "tools-v1.json");
    await pin(repo, "tools-v2.json");
    assert.notEqual(decision(await callSearch(repo)), "ask");
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"feature":"mcp-pin".*"tool":"mcp__docs__search"/);
  });

  it("refuses input that is not a tool list", async () => {
    const repo = setup("active");
    repo.write("bad.json", '{"servers": []}\n');
    const result = await pin(repo, "bad.json");
    assert.notEqual(result.code, 0);
  });
});
