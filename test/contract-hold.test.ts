import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { trustContract } from "../src/gate/trust-contract.js";
import { composeDecisions, type HookInput } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { withPolicy } from "../src/policy/guards.js";
import { CONTRACT_HOLD_GUARD, contractHold } from "../src/task/contract-hold.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";

const t = createTranslator("en");
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const pending = (policy: string): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "change a",
    size: "S",
    base: undefined,
    paths: [],
    runs: [],
    tests: "node --test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  repo.write(".finitemonkey/policy.yml", policy);
  const file = join(repo.root, ".finitemonkey/tasks/t1.yml");
  const text = readFileSync(file, "utf8").replace(
    "acceptance:\n",
    "acceptance:\n  - id: lint\n    check: command\n    run: npm run lint\n",
  );
  repo.write(".finitemonkey/tasks/t1.yml", text);
  return repo;
};

const write = async (repo: Repo, file: string) => {
  const raw = { tool_name: "Write", tool_input: { file_path: join(repo.root, file), content: "x" } };
  const parsed = parseHookPayload(
    "PreToolUse",
    JSON.stringify({ session_id: "s1", cwd: repo.root, hook_event_name: "PreToolUse", ...raw }),
    false,
  );
  assert.ok(parsed.ok);
  const input: HookInput = {
    event: "PreToolUse",
    payload: parsed.value,
    cwd: repo.root,
    runtime: repoRuntime(),
    t,
    env: {},
  };
  const handlers = withPolicy({ id: CONTRACT_HOLD_GUARD, damage: false, handlers: { PreToolUse: [contractHold] } });
  return composeDecisions(input, handlers.PreToolUse ?? []);
};

describe("writes wait while the contract has unapproved checks", () => {
  it("in active mode, a write outside .finitemonkey/ is held once with the next action", async () => {
    const repo = pending("guards:\n  contract-hold: active\n");
    assert.equal((await write(repo, ".finitemonkey/notes.md")).kind, "allow");
    const held = await write(repo, "src/a.js");
    assert.ok(held.kind === "block");
    assert.match(held.reason, /contract of task t1 has checks the person has not approved yet/);
    assert.match(JSON.stringify(held.output), /finitemonkey task trust t1/);
    assert.doesNotMatch(held.reason, /task trust/);
    assert.equal((await write(repo, "src/a.js")).kind, "allow");
  });

  it("an approved contract holds nothing", async () => {
    const repo = pending("guards:\n  contract-hold: active\n");
    assert.equal(trustContract(repoRuntime(), fmPaths(repo.root), "t1", "person@test").kind, "trusted");
    assert.equal((await write(repo, "src/a.js")).kind, "allow");
  });

  it("starts in shadow: the write goes through and the hold is logged", async () => {
    const repo = pending("level: standard\n");
    assert.equal((await write(repo, "src/a.js")).kind, "allow");
    const log = readFileSync(join(repo.root, ".finitemonkey/log.jsonl"), "utf8");
    assert.match(log, /"event":"guard_shadow".*"guard":"contract-hold"/);
  });
});
