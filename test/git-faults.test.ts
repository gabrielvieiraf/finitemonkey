import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AbsolutePath } from "../src/core/brand.js";
import { reject } from "../src/core/parsed.js";
import { gitPreToolUse } from "../src/git/hooks/pre-tool.js";
import { gitPostToolUse, gitSessionStart } from "../src/git/hooks/session.js";
import { gitStop } from "../src/git/hooks/stop.js";
import { JOURNAL_FILE } from "../src/git/journal.js";
import { BACKUP_PREFIX } from "../src/git/snapshot.js";
import { bash, edit, git, hook, initRepo, reasonOf, runtime, SESSION, t, tempDir, write } from "./git-support.js";

interface Sandbox {
  readonly root: AbsolutePath;
  readonly remote: string;
  readonly dispose: () => void;
}

const sandbox = (): Sandbox => {
  const remote = tempDir("fm-remote-");
  git(remote, "init", "-q", "--bare", "-b", "main");
  const root = tempDir("fm-fault-");
  initRepo(root);
  write(root, "README.md", "hello\n");
  write(root, "src/app.ts", "export const app = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "-u", "origin", "main");
  git(root, "switch", "-q", "-c", "feat/task");
  git(root, "push", "-q", "-u", "origin", "feat/task");
  return {
    root,
    remote,
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
      rmSync(`${root}-wt`, { recursive: true, force: true });
    },
  };
};

const pre = (root: AbsolutePath, command: string) => hook(gitPreToolUse, "PreToolUse", root, bash(command));

const edited = async (root: AbsolutePath, path: string, content: string): Promise<void> => {
  write(root, path, content);
  await hook(gitPostToolUse, "PostToolUse", root, edit(join(root, path)));
};

const backups = (root: string): readonly string[] =>
  git(root, "for-each-ref", "--format=%(refname)", BACKUP_PREFIX)
    .split("\n")
    .filter((line) => line !== "");

describe("git fault injection (spec 4.16, Etapa 1)", () => {
  it("case 10: Stop refuses done with session changes uncommitted, then unpushed, then passes", async () => {
    const box = sandbox();
    try {
      await hook(gitSessionStart, "SessionStart", box.root);
      await edited(box.root, "src/app.ts", "export const app = 2;\n");
      const dirty = await hook(gitStop, "Stop", box.root);
      assert.equal(dirty.kind, "block");
      assert.match(reasonOf(dirty), /src\/app\.ts/);
      git(box.root, "commit", "-q", "-am", "feat: app 2");
      const unpushed = await hook(gitStop, "Stop", box.root);
      assert.match(reasonOf(unpushed), /1 commit\(s\)/);
      git(box.root, "push", "-q");
      assert.equal((await hook(gitStop, "Stop", box.root)).kind, "allow");
    } finally {
      box.dispose();
    }
  });

  it("case 10: Stop ignores files that were dirty before the session started", async () => {
    const box = sandbox();
    try {
      write(box.root, "notes.txt", "mine\n");
      await hook(gitSessionStart, "SessionStart", box.root);
      assert.equal((await hook(gitStop, "Stop", box.root)).kind, "allow");
    } finally {
      box.dispose();
    }
  });

  it("cases 11, 16, 18: a dirty worktree on a merged branch cannot be force-removed or rm -rf'd", async () => {
    const box = sandbox();
    const tree = `${box.root}-wt`;
    try {
      git(box.root, "worktree", "add", "-q", tree, "-b", "feat/paginas", "main");
      write(tree, "src/api/endpoints.ts", "export const e = 1;\n");
      write(tree, "src/api/hooks/index.ts", "export {};\n");
      await hook(gitSessionStart, "SessionStart", box.root);
      for (const command of [
        `git worktree remove --force ${tree}`,
        `git worktree remove -f ${tree}`,
        `rm -rf ${tree}`,
        `rm -rf ${tree}/`,
        `cd .. && rm -fr ${tree}`,
        `sh -c 'rm -rf ${tree}'`,
        `rm -rf ${tree}/.git`,
      ]) {
        const decision = await pre(box.root, command);
        assert.equal(decision.kind, "block", command);
      }
      const plain = spawnSync("git", ["worktree", "remove", tree], { cwd: box.root, encoding: "utf8" });
      assert.notEqual(plain.status, 0);
      assert.ok(existsSync(join(tree, "src/api/endpoints.ts")));
    } finally {
      box.dispose();
    }
  });

  it("case 12: undoing everything is blocked over files dirty before the session, own files pass with a snapshot", async () => {
    const box = sandbox();
    try {
      write(box.root, "README.md", "edited by the person\n");
      await hook(gitSessionStart, "SessionStart", box.root);
      await edited(box.root, "src/app.ts", "export const app = 3;\n");
      for (const command of [
        "git checkout -- .",
        "git restore .",
        "git reset --hard",
        "git checkout HEAD -- README.md",
      ]) {
        const decision = await pre(box.root, command);
        assert.equal(decision.kind, "block", command);
        assert.match(reasonOf(decision), /README\.md/, command);
      }
      const own = await pre(box.root, "git checkout -- src/app.ts");
      assert.equal(own.kind, "allow");
      assert.equal(backups(box.root).length, 1);
      assert.match(JSON.stringify(own), /refs\/finitemonkey\/backup/);
    } finally {
      box.dispose();
    }
  });

  it("case 12: a file changed by another session counts as foreign", async () => {
    const box = sandbox();
    try {
      await hook(gitSessionStart, "SessionStart", box.root);
      write(box.root, "src/app.ts", "export const app = 9;\n");
      const decision = await pre(box.root, "git restore src/app.ts");
      assert.equal(decision.kind, "block");
    } finally {
      box.dispose();
    }
  });

  it("case 13: a rejected push is never forced; an explicit lease on the own branch passes", async () => {
    const box = sandbox();
    try {
      await hook(gitSessionStart, "SessionStart", box.root);
      const sha = git(box.root, "rev-parse", "origin/feat/task");
      for (const command of [
        "git push --force",
        "git push -f origin feat/task",
        "git push origin +feat/task",
        "git push --force-with-lease",
      ]) {
        assert.equal((await pre(box.root, command)).kind, "block", command);
      }
      const lease = `git push --force-with-lease=feat/task:${sha} --force-if-includes origin feat/task`;
      assert.equal((await pre(box.root, lease)).kind, "allow");
      const onMain = `git push --force-with-lease=main:${sha} --force-if-includes origin main`;
      assert.equal((await pre(box.root, onMain)).kind, "block");
    } finally {
      box.dispose();
    }
  });

  it("snapshot captures HEAD, index and untracked files without touching the index", async () => {
    const box = sandbox();
    try {
      await hook(gitSessionStart, "SessionStart", box.root);
      await edited(box.root, "src/app.ts", "export const app = 4;\n");
      await edited(box.root, "src/new.ts", "export const fresh = true;\n");
      git(box.root, "add", "src/app.ts");
      const indexBefore = git(box.root, "ls-files", "-s");
      const statusBefore = git(box.root, "status", "--porcelain");
      const decision = await pre(box.root, "git reset --hard");
      assert.equal(decision.kind, "allow", reasonOf(decision));
      const [ref] = backups(box.root);
      assert.ok(ref !== undefined);
      assert.equal(git(box.root, "show", `${ref}:src/new.ts`), "export const fresh = true;");
      assert.equal(git(box.root, "show", `${ref}:src/app.ts`), "export const app = 4;");
      assert.equal(git(box.root, "ls-files", "-s"), indexBefore);
      assert.equal(git(box.root, "status", "--porcelain"), statusBefore);
      const journal = readFileSync(join(box.root, JOURNAL_FILE), "utf8");
      assert.match(journal, /"op":"reset --hard"/);
      assert.match(journal, new RegExp(SESSION));
    } finally {
      box.dispose();
    }
  });

  it("blocks the risky operation when the snapshot cannot be taken", async () => {
    const box = sandbox();
    try {
      await hook(gitSessionStart, "SessionStart", box.root);
      await edited(box.root, "src/app.ts", "export const app = 5;\n");
      const broken = { ...runtime, writeAtomic: () => reject("disk full") };
      const decision = await gitPreToolUse({
        event: "PreToolUse",
        cwd: box.root,
        runtime: broken,
        t,
        payload: {
          hookEventName: "PreToolUse",
          sessionId: SESSION,
          cwd: box.root,
          stopHookActive: false,
          raw: { session_id: SESSION, ...bash("git reset --hard") },
        },
      });
      assert.equal(decision.kind, "block");
      assert.match(reasonOf(decision), /disk full/);
    } finally {
      box.dispose();
    }
  });

  it("protected branch: no commit on main from the agent, and switching inside a chain is followed", async () => {
    const box = sandbox();
    try {
      await hook(gitSessionStart, "SessionStart", box.root);
      git(box.root, "switch", "-q", "main");
      assert.equal((await pre(box.root, "git commit -m 'feat: x'")).kind, "block");
      assert.equal((await pre(box.root, "git switch -c feat/y && git commit -m 'feat: y'")).kind, "allow");
      assert.equal((await pre(box.root, "git push origin HEAD:main")).kind, "block");
    } finally {
      box.dispose();
    }
  });
});
