import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { checkRewriters } from "../src/doctor/rewriters.js";
import { isSensitiveCommand } from "../src/guards/rewrite/sensitive.js";
import { composeDecisions, DEFAULT_HANDLERS, type HookHandler } from "../src/hooks/handlers.js";
import { hook, runtime, SESSION, type TempRepo, tempRepo } from "./git-support.js";
import { SAMPLES } from "./secret-samples.js";
import { fakeRuntime } from "./support.js";

const all =
  (event: "PreToolUse" | "PostToolUse" | "Stop"): HookHandler =>
  (input) =>
    composeDecisions(input, DEFAULT_HANDLERS[event] ?? []);

const call = (id: string, command: string) => ({ tool_name: "Bash", tool_use_id: id, tool_input: { command } });

describe("which commands are sensitive", () => {
  for (const command of [
    "git push origin main",
    "git reset --hard",
    "rm -rf build",
    "ssh app.example.com",
    "cat .env",
    "git commit --no-verify -m x",
  ]) {
    it(`sensitive: ${command}`, () => {
      assert.equal(isSensitiveCommand(command), true);
    });
  }
  for (const command of ["ls -la", "git status", "git log --oneline", "npm test", "cat README.md"]) {
    it(`not sensitive: ${command}`, () => {
      assert.equal(isSensitiveCommand(command), false);
    });
  }
});

describe("a hook that rewrites the command after Finite Monkey checked it", () => {
  let repo: TempRepo | undefined;
  before(() => {
    repo = tempRepo({ "README.md": "x\n" });
  });
  after(() => {
    repo?.dispose();
  });

  const logText = (): string => {
    assert.ok(repo);
    const text = runtime.readText(toAbsolutePath(join(repo.root, ".finitemonkey", "log.jsonl")));
    return text.ok ? text.value : "";
  };

  it("blocks a sensitive command that ran in a different form, logs both versions masked, and fails the stop", async () => {
    assert.ok(repo);
    const token = SAMPLES.githubPat;
    const checked = "git push origin feat/x";
    const ran = `git push --force https://x:${token}@github.com/a/b.git feat/x`;
    assert.equal((await hook(all("PreToolUse"), "PreToolUse", repo.root, call("t1", checked))).kind, "allow");
    const post = await hook(all("PostToolUse"), "PostToolUse", repo.root, call("t1", ran));
    assert.equal(post.kind, "block");
    assert.match(post.reason, /another hook rewrote it/);
    const log = logText();
    assert.match(log, /"event":"input_rewritten"/);
    assert.match(log, /git push --force/);
    assert.ok(!log.includes(token), "the log leaked the token");
    assert.match(log, /«secret:/);
    const stop = await hook(all("Stop"), "Stop", repo.root, {});
    assert.equal(stop.kind, "block");
  });

  it("lets a non-sensitive command rewritten by another hook pass", async () => {
    assert.ok(repo);
    await hook(all("PreToolUse"), "PreToolUse", repo.root, call("t2", "ls"));
    const post = await hook(all("PostToolUse"), "PostToolUse", repo.root, call("t2", "ls -la"));
    assert.equal(post.kind, "allow");
  });

  it("lets a sensitive command that ran exactly as checked pass", async () => {
    assert.ok(repo);
    await hook(all("PreToolUse"), "PreToolUse", repo.root, call("t3", "git push origin feat/y"));
    const post = await hook(all("PostToolUse"), "PostToolUse", repo.root, call("t3", "git  push origin feat/y "));
    assert.equal(post.kind, "allow");
    assert.equal(SESSION.length > 0, true);
  });
});

describe("doctor lists hooks that can rewrite shell commands", () => {
  const root = toAbsolutePath("/home/ana/project");
  const settings = (hooks: unknown) =>
    fakeRuntime({ files: { [toAbsolutePath(join(root, ".claude", "settings.json"))]: JSON.stringify({ hooks }) } });
  const doctor = (rt: ReturnType<typeof fakeRuntime>) =>
    checkRewriters({ platform: "linux", env: {}, cwd: root, root, version: "1.0.0", runtime: rt });

  it("warns about a foreign PreToolUse hook on Bash, the rewriting hook fixture", () => {
    const rt = settings({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node .claude/hooks/rewrite-git.mjs" }] }],
    });
    const items = doctor(rt);
    assert.deepEqual(
      items.map((item) => [item.check, item.status, item.params?.["list"]]),
      [["hooks.rewriters", "warn", "node"]],
    );
  });

  it("stays quiet when only Finite Monkey hooks or non-shell matchers are present", () => {
    const rt = settings({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "node", args: ["x/finitemonkey.mjs", "hook", "PreToolUse"] }],
        },
        { matcher: "Write", hooks: [{ type: "command", command: "prettier-hook" }] },
      ],
    });
    assert.deepEqual(doctor(rt), []);
  });
});
