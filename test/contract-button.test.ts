import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { promptRelease } from "../src/gate/hooks/prompt.js";
import { selfGuard } from "../src/guards/self/hook.js";
import { fmPaths } from "../src/task/paths.js";
import { readTrust, writeState } from "../src/task/state.js";
import { bash, hook, runtime, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field, ROOT } from "./support.js";

const CONTRACT = [
  "id: t1",
  "goal: refunds go back to the card",
  "size: M",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node -e 0",
  "",
].join("\n");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const draft = (): TempRepo => {
  const repo = tempRepo({ "src/a.js": "export const a = 1;\n" });
  repos.push(repo);
  write(repo.root, ".finitemonkey/tasks/t1.yml", CONTRACT);
  writeState(runtime, fmPaths(repo.root), { active: "t1", done: [] });
  return repo;
};

const run = (repo: TempRepo, args: readonly string[]): ReturnType<typeof cliJson> =>
  cliJson(args, { cwd: repo.root, runtime: repoRuntime() });

const sources = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)],
  );

describe("contract approval by button", () => {
  it("approving the shown hash through the CLI stores the same hash as fm: trust in the prompt", async () => {
    const byPrompt = draft();
    const byButton = draft();
    await hook(promptRelease, "UserPromptSubmit", byPrompt.root, { prompt: "fm: trust t1" });
    const shown = await run(byButton, ["task", "trust"]);
    assert.equal(field(shown.body, "data", "trusted"), false, shown.stdout);
    const hash = field(shown.body, "data", "hash");
    assert.equal(typeof hash, "string");
    const approved = await run(byButton, ["task", "trust", "t1", "--hash", String(hash)]);
    assert.equal(approved.code, 0, approved.stdout);
    const prompt = readTrust(runtime, fmPaths(byPrompt.root));
    const button = readTrust(runtime, fmPaths(byButton.root));
    assert.equal(button.contracts["t1"], hash);
    assert.equal(button.contracts["t1"], prompt.contracts["t1"]);
    assert.equal(button.approved["t1"], prompt.approved["t1"]);
    const again = await run(byButton, ["task", "trust"]);
    assert.equal(field(again.body, "data", "trusted"), true);
  });

  it("refuses an approval when the contract changed after it was shown", async () => {
    const repo = draft();
    const shown = await run(repo, ["task", "trust"]);
    const hash = String(field(shown.body, "data", "hash"));
    const digest = String(field(shown.body, "data", "digest"));
    write(repo.root, ".finitemonkey/tasks/t1.yml", CONTRACT.replace("the card", "the wallet"));
    const goal = await run(repo, ["task", "trust", "t1", "--hash", hash, "--digest", digest]);
    assert.notEqual(goal.code, 0, goal.stdout);
    write(repo.root, ".finitemonkey/tasks/t1.yml", CONTRACT.replace("node -e 0", "node -e 1"));
    const check = await run(repo, ["task", "trust", "t1", "--hash", hash]);
    assert.notEqual(check.code, 0, check.stdout);
    assert.equal(readTrust(runtime, fmPaths(repo.root)).contracts["t1"], undefined);
  });

  it("denies the agent the approving forms of task trust and task diverge", async () => {
    const repo = draft();
    for (const command of ["fm task trust t1 --hash abc", "finitemonkey task diverge t1 --want 'refund 3'"]) {
      const decision = await hook(selfGuard, "PreToolUse", repo.root, bash(command));
      assert.equal(decision.kind, "block", command);
    }
    const reading = await hook(selfGuard, "PreToolUse", repo.root, bash("fm task trust t1"));
    assert.equal(reading.kind, "allow");
  });

  it("has no approval path through $.ui.ask in the mod", () => {
    const files = [...sources(join(ROOT, "src", "mod")), join(ROOT, "plugin", "hooks", "register.mjs")];
    for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), /ui\.ask\b|AskUserQuestion/, file);
  });
});
