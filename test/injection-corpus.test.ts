import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { dataBlock, hiddenChars, showHidden } from "../src/policy/untrusted.js";
import { contextOf, denied, fireHook, policyWith } from "./guardian-support.js";
import { INJECTION_CORPUS, type InjectionCase } from "./injection-corpus.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson } from "./support.js";

const MEMORY = "/home/ana/.claude/projects/-home-ana-app/memory/notes.md";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const setup = (): Repo => {
  const repo = makeRepo({
    "src/billing.ts": "export function charge(): number {\n  return 1;\n}\n",
    ".finitemonkey/policy.yml": policyWith({ "knowledge-claims": "active" }),
  });
  repos.push(repo);
  return repo;
};

const read = (repo: Repo, item: InjectionCase) =>
  fireHook(repo, "PostToolUse", { tool_name: item.tool, tool_input: item.input, tool_response: { result: item.page } });

const writeMemory = (repo: Repo, content: string) =>
  fireHook(repo, "PreToolUse", { tool_name: "Write", tool_input: { file_path: MEMORY, content } });

const agentClaim = (repo: Repo, text: string) =>
  cliJson(["claims", "add", text, "--anchor", "src/billing.ts"], {
    cwd: repo.root,
    runtime: repoRuntime(),
    env: { CLAUDECODE: "1" },
  });

describe("injection corpus", () => {
  it("has at least eight cases, one per hiding place", () => {
    assert.ok(INJECTION_CORPUS.length >= 8);
  });

  for (const item of INJECTION_CORPUS) {
    it(`${item.name}: the planted line reaches neither memory nor claims`, async () => {
      const repo = setup();
      await read(repo, item);
      assert.ok(denied(await writeMemory(repo, `Notes from the source.\n${item.planted}\n`)), "memory write");
      assert.ok(!denied(await writeMemory(repo, `${item.fact}\n`)), "plain fact");
      const claim = await agentClaim(repo, item.planted);
      assert.notEqual(claim.code, 0, claim.stdout);
      const started = await fireHook(repo, "SessionStart", { source: "startup" });
      assert.doesNotMatch(contextOf(started), /evil\.example|previous instructions|settings\.json/);
    });

    it(`${item.name}: the content stays readable as data`, () => {
      const block = dataBlock(item.tool, item.page);
      assert.equal(block.match(/<\/untrusted-data>/g)?.length, 1);
      assert.equal(hiddenChars(block).length, 0);
      assert.ok(block.includes(showHidden(item.planted.replace(/\.$/, ""))), block);
    });
  }
});
