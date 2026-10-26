import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { toPosixPath } from "../src/core/posix-path.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { runtime as nodeRt, tempDir } from "./git-support.js";
import { BUNDLE, cliJson, fakeRuntime, field, found, stdinFrom } from "./support.js";

const runtime = { ...nodeRt, probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };
const BIN = toPosixPath(BUNDLE);
const base = tempDir("fm-hook-managers-");

after(() => {
  rmSync(base, { recursive: true, force: true });
});

let counter = 0;

const project = (files: Readonly<Record<string, string>>): AbsolutePath => {
  counter += 1;
  const root = join(base, String(counter));
  mkdirSync(join(root, ".git"), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return toAbsolutePath(root);
};

const init = (root: AbsolutePath) => cliJson(["init", "--yes", "--bin", BIN], { cwd: root, runtime, env: {} });

const actionOf = async (root: AbsolutePath, path: string): Promise<unknown> => {
  const plan = await cliJson(["init", "--dry-run", "--bin", BIN], { cwd: root, runtime, env: {} });
  const items = field(plan.body, "data", "actions");
  return (Array.isArray(items) ? items : []).find((item) => field(item, "path") === path);
};

const PRE_COMMIT =
  "repos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    rev: v5.0.0\n    hooks:\n      - id: trailing-whitespace\n";

describe("init adds steps to an existing hook manager and never replaces it", () => {
  it("husky: keeps the existing hook line and uninstall restores the file byte for byte", async () => {
    const original = "npm test\n";
    const root = project({ ".husky/pre-commit": original });
    assert.equal((await init(root)).code, 0);
    const text = readFileSync(join(root, ".husky/pre-commit"), "utf8");
    assert.ok(text.startsWith(original));
    assert.match(text, /secrets scan --staged/);
    assert.equal((await cliJson(["uninstall", "--yes"], { cwd: root, runtime, env: {} })).code, 0);
    assert.equal(readFileSync(join(root, ".husky/pre-commit"), "utf8"), original);
  });

  it("pre-commit framework: appends a local repo with the three stages", async () => {
    const root = project({ ".pre-commit-config.yaml": PRE_COMMIT });
    assert.equal((await init(root)).code, 0);
    const text = readFileSync(join(root, ".pre-commit-config.yaml"), "utf8");
    assert.ok(text.startsWith(PRE_COMMIT));
    assert.match(text, /\n {2}- repo: local\n/);
    for (const stage of ["pre-commit", "commit-msg", "pre-push"])
      assert.match(text, new RegExp(`stages: \\[${stage}\\]`));
  });

  it("pre-commit framework: a file where repos is not last only gets a proposal", async () => {
    const root = project({ ".pre-commit-config.yaml": `${PRE_COMMIT}default_stages: [pre-commit]\n` });
    assert.equal(field(await actionOf(root, ".pre-commit-config.yaml"), "action"), "skip-foreign");
  });

  it("lefthook: adds the hooks when the file has none, proposes when it already defines one", async () => {
    const fresh = project({ "lefthook.yml": "output:\n  - summary\n" });
    assert.equal(field(await actionOf(fresh, "lefthook.yml"), "action"), "merge");
    const busy = project({ "lefthook.yml": "pre-commit:\n  commands:\n    lint:\n      run: npm run lint\n" });
    assert.equal(field(await actionOf(busy, "lefthook.yml"), "action"), "skip-foreign");
  });

  it("no hook manager: nothing is written for git hooks", async () => {
    const root = project({});
    assert.equal(await actionOf(root, ".husky/pre-commit"), undefined);
  });
});

describe("the agent cannot skip the git hooks", () => {
  it("git commit --no-verify from the agent is blocked by the bypass guard", async () => {
    const fake = fakeRuntime();
    const cwd = toAbsolutePath("/home/ana/project");
    const outcome = await runHook("PreToolUse", {
      stdin: stdinFrom(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "s1",
          cwd,
          tool_name: "Bash",
          tool_input: { command: 'git commit --no-verify -m "feat: x"' },
        }),
      ),
      deadlineMs: 2000,
      handlers: DEFAULT_HANDLERS,
      cwd,
      t: createTranslator("en"),
      startTimer: fake.startTimer,
      runtime: fake,
    });
    assert.match(outcome.stdout, /"permissionDecision":"deny"/);
    assert.match(outcome.stdout, /--no-verify/);
  });
});
