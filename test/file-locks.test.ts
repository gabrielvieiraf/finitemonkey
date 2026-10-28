import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { toPosixPath } from "../src/core/posix-path.js";
import { BACKUPS_DIR, fileLockGuard, fileLockRelease } from "../src/guards/files/hook.js";
import { scopeCopyGuard } from "../src/guards/scope/copy.js";
import type { HookEvent } from "../src/hooks/events.js";
import type { HookHandler } from "../src/hooks/handlers.js";
import { bash, git, runtime, t, tempDir, tempRepo, write } from "./git-support.js";

const fire = async (
  handler: HookHandler,
  event: HookEvent,
  cwd: AbsolutePath,
  project: AbsolutePath,
  raw: JsonObject,
) =>
  handler({
    event,
    cwd,
    runtime,
    t,
    env: { CLAUDE_PROJECT_DIR: project },
    payload: {
      hookEventName: event,
      sessionId: "main-session",
      cwd,
      stopHookActive: false,
      raw: { session_id: "main-session", ...raw },
    },
  });

const writeBy = (agent: string, path: string): JsonObject => ({
  agent_id: agent,
  tool_name: "Write",
  tool_input: { file_path: path, content: "new\n" },
});

describe("file locks outside git", () => {
  it("a second front is blocked while the first holds the file, and the lock goes when the first front ends", async () => {
    const repo = tempRepo();
    const docs = tempDir("fm-docs-");
    try {
      const notes = join(docs, "plan.md");
      write(docs, "plan.md", "original\n");
      assert.equal(
        (await fire(fileLockGuard, "PreToolUse", repo.root, repo.root, writeBy("front-1", notes))).kind,
        "allow",
      );
      const second = await fire(fileLockGuard, "PreToolUse", repo.root, repo.root, writeBy("front-2", notes));
      assert.ok(second.kind === "block");
      assert.match(second.reason, /in use by front-1/);
      assert.match(second.reason, /separate file and merge it later/);
      assert.equal(
        (await fire(fileLockGuard, "PreToolUse", repo.root, repo.root, writeBy("front-1", notes))).kind,
        "allow",
      );
      await fire(fileLockRelease, "SubagentStop", repo.root, repo.root, { agent_id: "front-1" });
      assert.equal(
        (await fire(fileLockGuard, "PreToolUse", repo.root, repo.root, writeBy("front-2", notes))).kind,
        "allow",
      );
    } finally {
      repo.dispose();
      rmSync(docs, { recursive: true, force: true });
    }
  });

  it("the original is backed up before the write lands", async () => {
    const repo = tempRepo();
    const docs = tempDir("fm-docs-");
    try {
      const sheet = join(docs, "budget.csv");
      write(docs, "budget.csv", "a,b\n1,2\n");
      const decision = await fire(fileLockGuard, "PreToolUse", repo.root, repo.root, writeBy("front-1", sheet));
      assert.equal(decision.kind, "allow");
      const stamps = readdirSync(join(repo.root, BACKUPS_DIR));
      assert.equal(stamps.length, 1);
      const copy = join(
        repo.root,
        BACKUPS_DIR,
        stamps[0] ?? "",
        toPosixPath(sheet)
          .replace(/^[A-Za-z]:/, "")
          .replace(/^\/+/, ""),
      );
      assert.equal(readFileSync(copy, "utf8"), "a,b\n1,2\n");
    } finally {
      repo.dispose();
      rmSync(docs, { recursive: true, force: true });
    }
  });

  it("files tracked by git are left to the git guard", async () => {
    const repo = tempRepo({ "src/a.ts": "a\n" });
    try {
      const decision = await fire(
        fileLockGuard,
        "PreToolUse",
        repo.root,
        repo.root,
        writeBy("front-1", join(repo.root, "src/a.ts")),
      );
      assert.equal(decision.kind, "allow");
      assert.ok(!existsSync(join(repo.root, ".finitemonkey", "locks")));
    } finally {
      repo.dispose();
    }
  });
});

describe("scope guard: copies from a front into the main checkout", () => {
  it("blocks cp, mv and redirects from a front worktree into the main checkout, and allows copies inside the front", async () => {
    const repo = tempRepo({ "src/a.ts": "a\n" });
    const front = toAbsolutePath(`${repo.root}-front`);
    try {
      git(repo.root, "worktree", "add", "-q", front, "-b", "front/F1");
      const main = toPosixPath(repo.root);
      const check = async (command: string, cwd: AbsolutePath) =>
        (await fire(scopeCopyGuard, "PreToolUse", cwd, repo.root, bash(command))).kind;
      assert.equal(await check(`cp src/a.ts ${main}/src/a.ts`, front), "block");
      assert.equal(await check(`mv src/a.ts ${main}/src/b.ts`, front), "block");
      assert.equal(await check(`cat src/a.ts > ${main}/src/c.ts`, front), "block");
      assert.equal(await check(`cp ${toPosixPath(front)}/src/a.ts src/a.ts`, repo.root), "block");
      assert.equal(await check("cp src/a.ts src/copy.ts", front), "allow");
      assert.equal(await check("cp src/a.ts src/copy.ts", repo.root), "allow");
    } finally {
      repo.dispose();
      rmSync(front, { recursive: true, force: true });
    }
  });
});
