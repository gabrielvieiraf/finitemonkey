import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { git, tempDir, tempRepo, write } from "./git-support.js";
import { BUNDLE, field, parseBody } from "./support.js";

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const fm = (cwd: string, args: readonly string[], input?: string, extraEnv: NodeJS.ProcessEnv = {}): Run => {
  const result = spawnSync(process.execPath, [BUNDLE, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], HOME: cwd, USERPROFILE: cwd, ...extraEnv },
    timeout: 30000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const json = (run: Run): unknown => parseBody(run.stdout);

describe("snapshot and undo commands", () => {
  it("snapshot saves a ref and undo restores it into a new worktree", () => {
    const repo = tempRepo({ "a.txt": "one\n" });
    let restored = "";
    try {
      write(repo.root, "a.txt", "two\n");
      write(repo.root, "fresh.txt", "untracked\n");
      const saved = fm(repo.root, ["snapshot", "--message", "before cleanup", "--json"]);
      assert.equal(saved.code, 0, saved.stderr);
      const ref = field(json(saved), "data", "ref");
      assert.ok(typeof ref === "string" && ref.startsWith("refs/finitemonkey/backup/"));
      git(repo.root, "reset", "-q", "--hard");
      rmSync(join(repo.root, "fresh.txt"));
      const listed = fm(repo.root, ["undo", "--list", "--json"]);
      assert.equal(listed.code, 0);
      const undone = fm(repo.root, ["undo", "--json"]);
      assert.equal(undone.code, 0, undone.stderr);
      const path = field(json(undone), "data", "path");
      assert.ok(typeof path === "string");
      restored = path;
      assert.equal(readFileSync(join(path, "a.txt"), "utf8"), "two\n");
      assert.equal(readFileSync(join(path, "fresh.txt"), "utf8"), "untracked\n");
      assert.equal(readFileSync(join(repo.root, "a.txt"), "utf8"), "one\n");
    } finally {
      repo.dispose();
      if (restored !== "") rmSync(restored, { recursive: true, force: true });
    }
  });

  it("undo --in-place needs a person at the terminal", () => {
    const repo = tempRepo();
    try {
      assert.equal(fm(repo.root, ["snapshot"]).code, 0);
      const run = fm(repo.root, ["undo", "--in-place", "--yes", "--json"]);
      assert.equal(run.code, 4);
      assert.equal(field(json(run), "error", "code"), "needs_confirmation");
    } finally {
      repo.dispose();
    }
  });

  it("undo without snapshots says there is nothing to undo", () => {
    const repo = tempRepo();
    try {
      const run = fm(repo.root, ["undo", "--json"]);
      assert.equal(run.code, 1);
      assert.equal(field(json(run), "error", "code"), "git_nothing_to_undo");
    } finally {
      repo.dispose();
    }
  });
});

describe("rescue command", () => {
  it("lists a commit lost by reset --hard and restores it into a new branch", () => {
    const repo = tempRepo();
    try {
      write(repo.root, "lost.txt", "work\n");
      git(repo.root, "add", "lost.txt");
      git(repo.root, "commit", "-q", "-m", "feat: lost work");
      const sha = git(repo.root, "rev-parse", "HEAD");
      git(repo.root, "reset", "-q", "--hard", "HEAD~1");
      const listed = fm(repo.root, ["rescue", "--json"]);
      assert.equal(listed.code, 0, listed.stderr);
      assert.match(listed.stdout, new RegExp(sha));
      const made = fm(repo.root, ["rescue", "--restore", sha, "--branch", "rescued", "--json"]);
      assert.equal(made.code, 0, made.stderr);
      assert.equal(git(repo.root, "rev-parse", "rescued"), sha);
      assert.equal(fm(repo.root, ["rescue", "--restore", sha, "--branch", "rescued"]).code, 1);
      assert.equal(fm(repo.root, ["rescue", "--restore", sha]).code, 2);
    } finally {
      repo.dispose();
    }
  });
});

describe("merge verify command", () => {
  it("exits 1 with the lost line and 0 on a clean merge, and checks a range for pre-push", () => {
    const repo = tempRepo({ "list.txt": "a\n" });
    try {
      const start = git(repo.root, "rev-parse", "HEAD");
      git(repo.root, "switch", "-q", "-c", "side");
      write(repo.root, "list.txt", "a\nside\n");
      git(repo.root, "commit", "-q", "-am", "side");
      git(repo.root, "switch", "-q", "main");
      write(repo.root, "other.txt", "o\n");
      git(repo.root, "add", "other.txt");
      git(repo.root, "commit", "-q", "-m", "main");
      assert.equal(fm(repo.root, ["merge", "verify"]).code, 0);
      git(repo.root, "merge", "-q", "--no-edit", "side");
      assert.equal(fm(repo.root, ["merge", "verify"]).code, 0);
      write(repo.root, "list.txt", "a\n");
      git(repo.root, "commit", "-q", "--amend", "-a", "--no-edit");
      const lost = fm(repo.root, ["merge", "verify", "--json"]);
      assert.equal(lost.code, 1, lost.stdout);
      assert.equal(field(json(lost), "error", "code"), "merge_lost_work");
      assert.match(lost.stdout, /side/);
      assert.equal(fm(repo.root, ["merge", "verify", "--since", start]).code, 1);
      assert.equal(fm(repo.root, ["merge", "verify", start]).code, 2);
    } finally {
      repo.dispose();
    }
  });
});

describe("hooks through the CLI", () => {
  it("PreToolUse denies git push --force with a JSON decision", () => {
    const repo = tempRepo();
    try {
      const payload = JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        tool_name: "Bash",
        tool_input: { command: "git push --force origin main" },
      });
      const run = fm(repo.root, ["hook", "PreToolUse"], payload);
      assert.equal(run.code, 0, run.stdout);
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /--force/);
    } finally {
      repo.dispose();
    }
  });

  it("commits authored through GIT_AUTHOR_EMAIL count as the user's own", () => {
    const repo = tempRepo();
    const remote = tempDir("fm-remote-");
    const author = { GIT_AUTHOR_NAME: "Bia", GIT_AUTHOR_EMAIL: "bia@example.com" };
    try {
      git(remote, "init", "-q", "--bare", "-b", "main");
      git(repo.root, "remote", "add", "origin", remote);
      git(repo.root, "push", "-q", "-u", "origin", "main");
      git(repo.root, "switch", "-q", "-c", "feat/env");
      write(repo.root, "env.txt", "env\n");
      git(repo.root, "add", "env.txt");
      const commit = spawnSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "env"], {
        cwd: repo.root,
        env: { ...process.env, ...author },
      });
      assert.equal(commit.status, 0);
      git(repo.root, "push", "-q", "-u", "origin", "feat/env");
      const payload = (session: string): string =>
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: session,
          tool_name: "Bash",
          tool_input: { command: "git rebase origin/main" },
        });
      assert.doesNotMatch(fm(repo.root, ["hook", "PreToolUse"], payload("s1"), author).stdout, /"deny"/);
      assert.match(fm(repo.root, ["hook", "PreToolUse"], payload("s2")).stdout, /"permissionDecision":"deny"/);
    } finally {
      repo.dispose();
      rmSync(remote, { recursive: true, force: true });
    }
  });

  it("SessionStart records the dirty baseline outside the tracked tree", () => {
    const repo = tempRepo();
    try {
      write(repo.root, "README.md", "dirty\n");
      const payload = JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", source: "compact" });
      assert.equal(fm(repo.root, ["hook", "SessionStart"], payload).code, 0);
      assert.ok(existsSync(join(repo.root, ".finitemonkey", "git", "baseline", "s1.json")));
    } finally {
      repo.dispose();
    }
  });
});
