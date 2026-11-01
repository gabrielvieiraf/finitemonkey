import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { readLessons } from "../src/learnings/store.js";
import { fmPaths } from "../src/task/paths.js";
import { fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const BEFORE = "export const limit = 10;\n";
const AFTER = "export const limit = 20;\n";

const setup = (): Repo => {
  const repo = makeRepo({ "src/limits.ts": BEFORE, ".finitemonkey/policy.yml": policyWith({ learnings: "active" }) });
  repos.push(repo);
  return repo;
};

const agentEdit = async (repo: Repo, from: string, to: string): Promise<void> => {
  repo.write("src/limits.ts", to);
  await fireHook(repo, "PostToolUse", {
    tool_name: "Edit",
    tool_input: { file_path: join(repo.root, "src", "limits.ts"), old_string: from.trim(), new_string: to.trim() },
    tool_response: { success: true },
  });
};

const personTurn = async (repo: Repo, text?: string): Promise<void> => {
  if (text !== undefined) repo.write("src/limits.ts", text);
  await fireHook(repo, "UserPromptSubmit", { prompt: "continue" });
};

const lessons = (repo: Repo) => readLessons(repoRuntime(), fmPaths(repo.root).dir);

describe("repeated corrections become lessons", () => {
  it("turns a change the person reverted twice into one lesson proposal with origin person", async () => {
    const repo = setup();
    await agentEdit(repo, BEFORE, AFTER);
    await personTurn(repo, BEFORE);
    assert.deepEqual(lessons(repo), []);
    await agentEdit(repo, BEFORE, AFTER);
    await personTurn(repo, BEFORE);
    const proposed = lessons(repo);
    assert.equal(proposed.length, 1);
    const [lesson] = proposed;
    assert.ok(lesson !== undefined);
    assert.equal(lesson.source, "correction");
    assert.equal(lesson.origin, "person");
    assert.equal(lesson.quarantined, true);
    assert.deepEqual(lesson.paths, ["src/limits.ts"]);
    assert.match(lesson.text, /limit = 10/);
    await agentEdit(repo, BEFORE, AFTER);
    await personTurn(repo, BEFORE);
    assert.equal(lessons(repo).length, 1);
  });

  it("does not count the agent undoing its own change", async () => {
    const repo = setup();
    await agentEdit(repo, BEFORE, AFTER);
    await agentEdit(repo, AFTER, BEFORE);
    await personTurn(repo);
    await agentEdit(repo, BEFORE, AFTER);
    await personTurn(repo, BEFORE);
    assert.deepEqual(lessons(repo), []);
  });

  it("does not count a change the person kept", async () => {
    const repo = setup();
    await agentEdit(repo, BEFORE, AFTER);
    await personTurn(repo);
    await agentEdit(repo, BEFORE, AFTER);
    await personTurn(repo);
    assert.deepEqual(lessons(repo), []);
  });
});
