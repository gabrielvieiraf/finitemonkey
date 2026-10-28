import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { Env } from "../src/core/context.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { GitResult, Runtime } from "../src/core/runtime.js";
import type { HookEvent } from "../src/hooks/events.js";
import { mergeHandlers } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { withPolicy } from "../src/policy/guards.js";
import { normalizeCommand } from "../src/shell/normalize.js";
import { isHeavy } from "../src/wt/heavy.js";
import { HEAVY_HANDLERS } from "../src/wt/heavy-hooks.js";
import { worktreeId, WT_PLACE_HANDLERS } from "../src/wt/place-hook.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const HANDLERS = mergeHandlers(
  withPolicy({ id: "heavy-lock", damage: false, handlers: HEAVY_HANDLERS }),
  WT_PLACE_HANDLERS,
);
const A = toAbsolutePath("/home/ana/shop/.claude/worktrees/a");
const B = toAbsolutePath("/home/ana/shop/.claude/worktrees/b");

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const heavy = (command: string): boolean => normalizeCommand(command).commands.some(isHeavy);

const machine = (config = ""): MemoryFs =>
  memoryFs({
    [toAbsolutePath(join(A, ".git"))]: "gitdir: /home/ana/shop/.git/worktrees/a\n",
    [toAbsolutePath(join(B, ".git"))]: "gitdir: /home/ana/shop/.git/worktrees/b\n",
    [toAbsolutePath(join(A, ".finitemonkey", "config.yml"))]: config,
  });

const fire = (
  runtime: Runtime,
  event: HookEvent,
  cwd: AbsolutePath,
  payload: JsonObject,
  env: Env = {},
): Promise<HookOutcome> =>
  runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd, ...payload })),
    deadlineMs: 20_000,
    handlers: HANDLERS,
    cwd,
    t: createTranslator("en"),
    startTimer: repoRuntime().startTimer,
    runtime,
    env,
  });

const bash = (id: string, command: string, background = false): JsonObject => ({
  tool_name: "Bash",
  tool_use_id: id,
  tool_input: { command, ...(background ? { run_in_background: true } : {}) },
});

const denied = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const reason = field(parseBody(outcome.stdout), "hookSpecificOutput", "permissionDecisionReason");
  return typeof reason === "string" ? reason : "";
};

const WSL: Env = { WSL_DISTRO_NAME: "Ubuntu" };

describe("heavy commands: what counts", () => {
  it("installs, builds and full test runs are heavy; reads and single files are not", () => {
    for (const command of [
      "npm ci",
      "npm install",
      "pnpm i",
      "yarn",
      "npm test",
      "npm run build",
      "npm run check",
      "pnpm build",
      "yarn test",
      "cargo build",
      "go test ./...",
      "npx tsc -p .",
      "pytest",
    ]) {
      assert.ok(heavy(command), command);
    }
    for (const command of [
      "npm run lint",
      "git status",
      "node --test test/a.test.ts",
      "npm run dev",
      "ls",
      "npx prettier --write .",
    ]) {
      assert.ok(!heavy(command), command);
    }
  });
});

describe("heavy commands: one at a time across worktrees", () => {
  it("with the limit at 1, a second heavy command in another worktree waits and says so", async () => {
    const fs = machine();
    const runtime = fakeRuntime({ fs });
    assert.equal(denied(await fire(runtime, "PreToolUse", A, bash("t1", "npm ci"), WSL)), "");
    const waiting = denied(await fire(runtime, "PreToolUse", B, bash("t2", "npm run build"), WSL));
    assert.match(waiting, /1 heavy command already running on this machine \(npm ci in .*a since/);
    assert.match(waiting, /wait until it finishes/);
    await fire(runtime, "PostToolUse", A, { ...bash("t1", "npm ci"), tool_response: { exitCode: 0 } }, WSL);
    assert.equal(denied(await fire(runtime, "PreToolUse", B, bash("t2", "npm run build"), WSL)), "");
  });

  it("the limit defaults to 1 on WSL, is off elsewhere, and reads config.yml and the environment", async () => {
    const off = fakeRuntime({ fs: machine() });
    await fire(off, "PreToolUse", A, bash("t1", "npm ci"));
    assert.equal(denied(await fire(off, "PreToolUse", B, bash("t2", "npm ci"))), "");
    const two = fakeRuntime({ fs: machine("wt:\n  heavy_limit: 2\n") });
    await fire(two, "PreToolUse", A, bash("t1", "npm ci"), WSL);
    assert.equal(denied(await fire(two, "PreToolUse", A, bash("t2", "npm test"), WSL)), "");
    assert.notEqual(denied(await fire(two, "PreToolUse", A, bash("t3", "npm run build"), WSL)), "");
    const env = fakeRuntime({ fs: machine() });
    await fire(env, "PreToolUse", A, bash("t1", "npm ci"), { FINITEMONKEY_HEAVY_LIMIT: "1" });
    assert.notEqual(
      denied(await fire(env, "PreToolUse", B, bash("t2", "npm ci"), { FINITEMONKEY_HEAVY_LIMIT: "1" })),
      "",
    );
  });

  it("a slot left behind is reclaimed after it goes stale, and a failure releases it too", async () => {
    const fs = machine();
    const runtime = fakeRuntime({ fs });
    await fire(runtime, "PreToolUse", A, bash("t1", "npm ci"), WSL);
    fs.tick(31 * 60_000);
    assert.equal(denied(await fire(runtime, "PreToolUse", B, bash("t2", "npm ci"), WSL)), "");
    await fire(runtime, "PostToolUseFailure", B, { ...bash("t2", "npm ci"), error: "exit 1" }, WSL);
    assert.equal(denied(await fire(runtime, "PreToolUse", A, bash("t3", "npm test"), WSL)), "");
  });

  it("a background heavy command waits for a free slot but does not hold it", async () => {
    const runtime = fakeRuntime({ fs: machine() });
    assert.equal(denied(await fire(runtime, "PreToolUse", A, bash("t1", "npm ci", true), WSL)), "");
    assert.equal(denied(await fire(runtime, "PreToolUse", B, bash("t2", "npm ci"), WSL)), "");
    assert.notEqual(denied(await fire(runtime, "PreToolUse", A, bash("t3", "npm ci", true), WSL)), "");
  });
});

describe("WorktreeCreate: worktrees off synced and mounted folders", () => {
  it("turns the requested name or branch into a worktree id", () => {
    assert.equal(worktreeId("worktree-fix/login page"), "fix-login-page");
    assert.equal(worktreeId("feat_1"), "feat_1");
  });

  it("a worktree requested under /mnt/c is placed under the Linux home and recorded", async (t) => {
    if (process.platform === "win32") {
      t.skip("/mnt/c paths exist only on Linux");
      return;
    }
    const main = toAbsolutePath("/mnt/c/Users/ana/OneDrive/shop");
    const added: string[][] = [];
    const ok = (stdout: string): GitResult => ({ found: true, ok: true, stdout });
    const fs = memoryFs({ [toAbsolutePath(join(main, ".git", "HEAD"))]: "ref: refs/heads/main\n" });
    const runtime = fakeRuntime({
      fs,
      git: (args) => {
        if (args.includes("--git-common-dir")) return ok(`${main}/.git\n`);
        if (args[0] === "symbolic-ref") return ok("main\n");
        if (args[0] === "rev-parse") return ok("0123456789abcdef0123456789abcdef01234567\n");
        return { found: true, ok: false, stdout: "" };
      },
      gitWith: (args) => {
        if (args[0] === "worktree" && args[1] === "list") {
          return {
            found: true,
            ok: true,
            stdout: `worktree ${main}\nHEAD 0123456\nbranch refs/heads/main\n\n`,
            stderr: "",
            timedOut: false,
          };
        }
        added.push([...args]);
        return { found: true, ok: true, stdout: "", stderr: "", timedOut: false };
      },
    });
    const outcome = await fire(runtime, "WorktreeCreate", main, { name: "login", repo_path: main });
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.equal(outcome.stdout.trim(), "/home/test/.finitemonkey/worktrees/shop/login");
    assert.deepEqual(added[0]?.slice(0, 4), ["worktree", "add", "-b", "worktree-login"]);
    assert.ok(!added.some((args) => args[1] === "lock"));
    const registry = fs.readText(toAbsolutePath(join(main, ".git", "finitemonkey", "worktrees.yml")));
    assert.ok(registry.ok && registry.value.includes("/home/test/.finitemonkey/worktrees/shop/login"));
  });

  it("creates a real worktree, prints only its path and removes it through WorktreeRemove", async () => {
    const repo = makeRepo({ "README.md": "# shop\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const outcome = await fire(runtime, "WorktreeCreate", repo.root, { name: "docs", repo_path: repo.root });
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    const path = outcome.stdout.trim();
    assert.equal(outcome.stdout.split("\n").filter((line) => line !== "").length, 1);
    assert.ok(existsSync(join(path, "README.md")));
    assert.match(repo.git("branch", "--list", "worktree-docs"), /worktree-docs/);
    const removed = await fire(runtime, "WorktreeRemove", repo.root, { worktree_path: path, repo_path: repo.root });
    assert.equal(removed.exitCode, 0, removed.stderr);
    assert.ok(!existsSync(path));
  });

  it("fails the creation when there is no repository", async () => {
    const runtime = fakeRuntime({ fs: memoryFs() });
    const outcome = await fire(runtime, "WorktreeCreate", toAbsolutePath("/home/ana/empty"), { name: "x" });
    assert.notEqual(outcome.exitCode, 0);
    assert.equal(outcome.stdout, "");
  });
});
