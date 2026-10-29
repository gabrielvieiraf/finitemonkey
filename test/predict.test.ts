import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { readBook } from "../src/conceitos/book.js";
import { predictGuard } from "../src/conceitos/predict.js";
import { promptRelease } from "../src/gate/hooks/prompt.js";
import { fmPaths } from "../src/task/paths.js";
import { hook, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const REFUND = [
  'const amount = Number(require("node:fs").readFileSync(0, "utf8").trim());',
  "console.log(`refund ${amount} to card`);",
  "",
].join("\n");

const CONTRACT = [
  "id: hooks",
  "goal: refund webhook",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node src/refund.js --version",
  "",
].join("\n");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const profile = (knowledge: number): string =>
  `domains:\n  backend:\n    tool: ${String(knowledge)}\n    knowledge: ${String(knowledge)}\nquick_start: done\n`;

const project = async (knowledge: number): Promise<TempRepo> => {
  const repo = tempRepo({ "src/refund.js": REFUND });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", "guards:\n  predict-gate: active\n  behavior-contract: active\n");
  write(repo.root, ".finitemonkey/perfil.yml", profile(knowledge));
  trustContract(repo.root, "hooks", CONTRACT);
  const opts = { cwd: repo.root, runtime: repoRuntime() };
  await cliJson(
    [
      "task",
      "examples",
      "hooks",
      "--says",
      "a refund of 50",
      "--run",
      "node src/refund.js",
      "--input",
      "50",
      "--expect",
      "refund 50 to card",
    ],
    opts,
  );
  await cliJson(["task", "examples", "hooks", "--approve", "E1"], opts);
  return repo;
};

const edit = (repo: TempRepo): ReturnType<typeof hook> =>
  hook(predictGuard, "PreToolUse", repo.root, {
    tool_name: "Edit",
    tool_input: { file_path: join(repo.root, "src/hook.js"), old_string: "", new_string: "// webhook handler" },
  });

const predict = (repo: TempRepo, output: string): ReturnType<typeof hook> =>
  hook(promptRelease, "UserPromptSubmit", repo.root, { prompt: `fm: predict webhook ${output}` });

const settle = async (repo: TempRepo): Promise<unknown> => {
  const gate = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime() });
  const items = field(gate.body, "data", "items");
  const entry: unknown = Array.isArray(items)
    ? items.find((value: unknown) => field(value, "id") === "examples")
    : undefined;
  const notes = field(entry, "notes");
  return Array.isArray(notes)
    ? notes.find((note: unknown) => String(field(note, "key")).startsWith("gate.predict."))
    : undefined;
};

describe("predict before the change lands", () => {
  it("asks a beginner for one prediction on an input before a change with a new concept", async () => {
    const repo = await project(10);
    const asked = await edit(repo);
    assert.ok(asked.kind === "block");
    assert.match(asked.reason, /50/);
    await predict(repo, "refund 50 to card");
    assert.equal((await edit(repo)).kind, "allow");
    const result = await settle(repo);
    assert.equal(field(result, "key"), "gate.predict.correct");
    assert.equal(field(result, "params", "actual"), "refund 50 to card");
  });

  it("fades after three correct predictions and comes back after a wrong one", async () => {
    const repo = await project(10);
    for (let round = 0; round < 3; round += 1) {
      assert.equal((await edit(repo)).kind, "block", `round ${String(round)}`);
      await predict(repo, "refund 50 to card");
      await settle(repo);
    }
    assert.equal(readBook(repoRuntime(), fmPaths(repo.root)).concepts.webhook?.demonstrated, true);
    assert.equal((await edit(repo)).kind, "allow");
    await predict(repo, "refund 50 to wallet");
    const wrong = await settle(repo);
    assert.equal(field(wrong, "key"), "gate.predict.wrong");
    assert.notEqual(readBook(repoRuntime(), fmPaths(repo.root)).concepts.webhook?.demonstrated, true);
    assert.equal((await edit(repo)).kind, "block");
  });

  it("never asks in deliver mode (advanced in the domain)", async () => {
    const repo = await project(90);
    assert.equal((await edit(repo)).kind, "allow");
  });

  it("can be skipped with one line, and the skip is logged", async () => {
    const repo = await project(10);
    await hook(promptRelease, "UserPromptSubmit", repo.root, { prompt: "fm: allow predict not now" });
    assert.equal((await edit(repo)).kind, "allow");
    assert.match(readFileSync(join(repo.root, ".finitemonkey", "log.jsonl"), "utf8"), /"event":"predict\.skipped"/);
  });
});
