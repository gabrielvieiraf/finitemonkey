import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { detectBypass } from "../src/guards/bypass/detect.js";
import { composeDecisions, DEFAULT_HANDLERS, type HookHandler } from "../src/hooks/handlers.js";
import { clearPause, pausedFor, readPause, setPause } from "../src/policy/pause.js";
import { pausePrompt } from "../src/policy/pause-hooks.js";
import { fmPaths } from "../src/task/paths.js";
import { bash, hook, reasonOf, runtime, SESSION, type TempRepo, tempRepo } from "./git-support.js";
import { SAMPLES } from "./secret-samples.js";

const all =
  (event: "PreToolUse" | "Stop"): HookHandler =>
  (input) =>
    composeDecisions(input, DEFAULT_HANDLERS[event] ?? []);

describe("fm off typed by the model", () => {
  for (const command of [
    "fm off",
    "finitemonkey on",
    "npx finitemonkey off",
    "node .finitemonkey/runtime/dist/finitemonkey.mjs off",
    "node node_modules/finitemonkey/dist/finitemonkey.mjs on",
    "echo ok && fm off",
  ]) {
    it(`is a bypass: ${command}`, () => {
      assert.deepEqual(
        detectBypass(command).map((finding) => finding.kind),
        ["fm_pause"],
      );
    });
  }

  it("does not flag unrelated words", () => {
    assert.deepEqual(detectBypass("echo fm off is typed by the person"), []);
    assert.deepEqual(detectBypass("npx finitemonkey doctor"), []);
  });
});

describe("fm off and fm on typed by the person", () => {
  let repo: TempRepo | undefined;
  before(() => {
    repo = tempRepo({
      "README.md": "x\n",
      ".finitemonkey/config.yml": "prod:\n  hosts:\n    - app.example.com\n",
    });
  });
  after(() => {
    repo?.dispose();
  });

  const paths = () => {
    assert.ok(repo);
    return fmPaths(repo.root);
  };

  it("a Bash call to fm off is blocked by the bypass guard", async () => {
    assert.ok(repo);
    const decision = await hook(all("PreToolUse"), "PreToolUse", repo.root, bash("fm off"));
    assert.equal(decision.kind, "block");
    assert.match(reasonOf(decision), /only the person pauses/);
    assert.equal(readPause(runtime, paths()), undefined);
  });

  it("the prompt fm off pauses only this session and fm on resumes it", async () => {
    assert.ok(repo);
    const off = await hook(pausePrompt, "UserPromptSubmit", repo.root, { prompt: "fm off" });
    assert.equal(off.kind, "block");
    assert.match(reasonOf(off), /Gate paused/);
    assert.ok(pausedFor(runtime, paths(), SESSION));
    assert.equal(pausedFor(runtime, paths(), "another-session"), undefined);
    const on = await hook(pausePrompt, "UserPromptSubmit", repo.root, { prompt: "  FM ON " });
    assert.match(reasonOf(on), /Gate resumed/);
    assert.equal(readPause(runtime, paths()), undefined);
    const log = runtime.readText(toAbsolutePath(join(repo.root, ".finitemonkey", "log.jsonl")));
    assert.ok(log.ok && log.value.includes("gate_paused") && log.value.includes("gate_resumed"));
  });

  it("a prompt that only mentions fm off does nothing", async () => {
    assert.ok(repo);
    const decision = await hook(pausePrompt, "UserPromptSubmit", repo.root, { prompt: "should I type fm off?" });
    assert.equal(decision.kind, "allow");
    assert.equal(readPause(runtime, paths()), undefined);
  });

  it("the pause ends with the session: another session's stop is checked again", async () => {
    assert.ok(repo);
    setPause(runtime, paths(), "older-session", "prompt");
    const stop = await hook(all("Stop"), "Stop", repo.root, {});
    assert.doesNotMatch(JSON.stringify(stop), /paused it with fm off/);
    clearPause(runtime, paths(), "prompt");
    setPause(runtime, paths(), SESSION, "prompt");
    const paused = await hook(all("Stop"), "Stop", repo.root, {});
    assert.equal(paused.kind, "allow");
    assert.match(JSON.stringify(paused), /paused it with fm off/);
    clearPause(runtime, paths(), "prompt");
  });

  it("secrets, production and destructive git guards keep blocking during the pause", async () => {
    assert.ok(repo);
    setPause(runtime, paths(), SESSION, "prompt");
    try {
      const secret = await hook(all("PreToolUse"), "PreToolUse", repo.root, {
        tool_name: "Write",
        tool_input: {
          file_path: join(repo.root, "src", "config.ts"),
          content: `export const k = "${SAMPLES.githubPat}";\n`,
        },
      });
      assert.equal(secret.kind, "block", "secrets");
      const prod = await hook(
        all("PreToolUse"),
        "PreToolUse",
        repo.root,
        bash("ssh app.example.com 'docker compose up -d'"),
      );
      assert.equal(prod.kind, "block", "production");
      const git = await hook(all("PreToolUse"), "PreToolUse", repo.root, bash("git push --force origin main"));
      assert.equal(git.kind, "block", "git");
    } finally {
      clearPause(runtime, paths(), "prompt");
    }
  });
});
