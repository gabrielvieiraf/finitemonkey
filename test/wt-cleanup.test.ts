import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AbsolutePath } from "../src/core/brand.js";
import { git, initRepo, tempDir, write } from "./git-support.js";
import { BUNDLE, field, parseBody } from "./support.js";

interface Box {
  readonly root: AbsolutePath;
  readonly home: AbsolutePath;
  readonly tree: (name: string) => string;
  readonly dispose: () => void;
}

const sandbox = (): Box => {
  const remote = tempDir("fm-wt-remote-");
  git(remote, "init", "-q", "--bare", "-b", "main");
  const root = tempDir("fm-wt-");
  const home = tempDir("fm-wt-home-");
  initRepo(root);
  write(root, "src/app.ts", "export const app = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "-u", "origin", "main");
  const trees: string[] = [];
  return {
    root,
    home,
    tree: (name) => {
      const path = `${root}-${name}`;
      trees.push(path);
      return path;
    },
    dispose: () => {
      for (const path of [root, remote, home, ...trees]) rmSync(path, { recursive: true, force: true });
    },
  };
};

const fm = (box: Box, args: readonly string[]) => {
  const result = spawnSync(process.execPath, [BUNDLE, ...args], {
    cwd: box.root,
    encoding: "utf8",
    env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], HOME: box.home, USERPROFILE: box.home },
    timeout: 60000,
  });
  assert.equal(result.status === 0 || result.status === 1, true, result.stderr);
  return parseBody(result.stdout);
};

interface Item {
  readonly path: string;
  readonly cls: string;
  readonly action: string;
}

const items = (body: unknown): readonly Item[] => {
  const list = field(body, "data", "items");
  assert.ok(Array.isArray(list));
  return list.map((item) => ({
    path: String(field(item, "path")),
    cls: String(field(item, "cls")),
    action: String(field(item, "action")),
  }));
};

const byBranch = (box: Box, body: unknown, branch: string): Item => {
  const list = field(body, "data", "items");
  assert.ok(Array.isArray(list));
  const found: unknown = list.find((item: unknown) => field(item, "branch") === branch);
  assert.ok(found, `${branch} in ${JSON.stringify(list)} (${box.root})`);
  return {
    path: String(field(found, "path")),
    cls: String(field(found, "cls")),
    action: String(field(found, "action")),
  };
};

const worktree = (box: Box, name: string, branch: string): string => {
  const path = box.tree(name);
  git(box.root, "worktree", "add", "-q", path, "-b", branch, "main");
  return path;
};

const commitIn = (path: string, file: string, content: string): void => {
  write(path, file, content);
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", `feat: ${file}`);
};

const archives = (box: Box): readonly string[] =>
  git(box.root, "for-each-ref", "--format=%(refname)", "refs/finitemonkey/archive/")
    .split("\n")
    .filter((line) => line !== "");

describe("wt clean classes (git fault cases 11, 14, 16, 18)", () => {
  it("case 11: a dirty worktree and one with an unpushed commit both stay, the second archived", () => {
    const box = sandbox();
    try {
      const dirty = worktree(box, "dirty", "feat/dirty");
      write(dirty, "notes.md", "draft\n");
      const ahead = worktree(box, "ahead", "feat/ahead");
      commitIn(ahead, "src/new.ts", "export const fresh = 1;\n");
      const plan = fm(box, ["wt", "clean", "--stale-days", "0", "--json"]);
      assert.equal(byBranch(box, plan, "feat/dirty").cls, "dirty");
      assert.equal(byBranch(box, plan, "feat/ahead").cls, "unpushed");
      const applied = fm(box, ["wt", "clean", "--apply", "--stale-days", "0", "--json"]);
      assert.equal(byBranch(box, applied, "feat/ahead").action, "archive-keep");
      assert.ok(existsSync(join(dirty, "notes.md")));
      assert.ok(existsSync(join(ahead, "src/new.ts")));
      assert.equal(archives(box).length, 1);
      assert.match(git(box.root, "show", `${archives(box)[0] ?? ""}:src/new.ts`), /fresh/);
    } finally {
      box.dispose();
    }
  });

  it("case 14: a squash-merged branch with a new commit after the merge is not equivalent and is kept", () => {
    const box = sandbox();
    try {
      const done = worktree(box, "squashed", "feat/squashed");
      commitIn(done, "src/a.ts", "export const a = 1;\n");
      const later = worktree(box, "later", "feat/later");
      commitIn(later, "src/b.ts", "export const b = 1;\n");
      for (const branch of ["feat/squashed", "feat/later"]) {
        git(box.root, "merge", "-q", "--squash", branch);
        git(box.root, "commit", "-q", "-m", `feat: squash ${branch}`);
      }
      commitIn(later, "src/b.ts", "export const b = 2;\n");
      const plan = fm(box, ["wt", "clean", "--stale-days", "0", "--json"]);
      assert.equal(byBranch(box, plan, "feat/squashed").cls, "equivalent");
      assert.equal(byBranch(box, plan, "feat/later").cls, "unpushed");
      fm(box, ["wt", "clean", "--apply", "--stale-days", "0", "--json"]);
      assert.ok(!existsSync(done));
      assert.ok(existsSync(join(later, "src/b.ts")));
      assert.match(git(box.root, "branch", "--list", "feat/later"), /feat\/later/);
      assert.equal(archives(box).length, 2);
    } finally {
      box.dispose();
    }
  });

  it("cases 16 and 18: a merged branch with uncommitted files is dirty and kept; archive on request keeps the files", () => {
    const box = sandbox();
    try {
      const pages = worktree(box, "pages", "feat/paginas-institucionais");
      for (const file of ["src/api/endpoints.ts", "src/api/hooks/index.ts", "src/api/schemas/error-codes.ts"]) {
        write(pages, file, `export const file = ${JSON.stringify(file)};\n`);
      }
      const applied = fm(box, ["wt", "clean", "--apply", "--stale-days", "0", "--json"]);
      const item = byBranch(box, applied, "feat/paginas-institucionais");
      assert.equal(item.cls, "dirty");
      assert.equal(item.action, "keep");
      assert.ok(existsSync(join(pages, "src/api/endpoints.ts")));
      const archived = fm(box, ["wt", "archive", "feat/paginas-institucionais", "--json"]);
      const ref = String(field(archived, "data", "archive", "ref"));
      assert.ok(!existsSync(pages));
      for (const file of ["src/api/endpoints.ts", "src/api/hooks/index.ts", "src/api/schemas/error-codes.ts"]) {
        assert.match(git(box.root, "show", `${ref}:${file}`), /export const file/);
      }
    } finally {
      box.dispose();
    }
  });
});

const sleeper = (cwd: string): ChildProcess =>
  spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd, stdio: "ignore" });

const exited = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else
      child.once("exit", () => {
        resolve();
      });
  });

describe("wt clean never removes protected classes", () => {
  it("dirty, locked, running, recent and unpushed survive --apply; a contained clean tree goes", () => {
    const box = sandbox();
    const running = process.platform === "win32" ? undefined : worktree(box, "running", "feat/running");
    const child = running === undefined ? undefined : sleeper(running);
    try {
      const dirty = worktree(box, "dirty", "feat/dirty");
      write(dirty, "x.txt", "x\n");
      const locked = worktree(box, "locked", "feat/locked");
      git(box.root, "worktree", "lock", locked);
      const ahead = worktree(box, "ahead", "feat/ahead");
      commitIn(ahead, "y.txt", "y\n");
      const merged = worktree(box, "merged", "feat/merged");
      const applied = fm(box, ["wt", "clean", "--apply", "--stale-days", "0", "--json"]);
      const classes = Object.fromEntries(items(applied).map((item) => [item.path, item.cls]));
      for (const path of [dirty, locked, ahead, ...(running === undefined ? [] : [running])]) {
        assert.ok(existsSync(path), `${path} kept (${JSON.stringify(classes)})`);
      }
      if (running !== undefined) assert.equal(byBranch(box, applied, "feat/running").cls, "running");
      assert.ok(!existsSync(merged));
      assert.equal(git(box.root, "branch", "--list", "feat/merged"), "");
      const recent = worktree(box, "recent", "feat/recent");
      const second = fm(box, ["wt", "clean", "--apply", "--json"]);
      assert.equal(byBranch(box, second, "feat/recent").cls, "recent");
      assert.ok(existsSync(recent));
      git(box.root, "worktree", "unlock", locked);
    } finally {
      child?.kill("SIGKILL");
      box.dispose();
    }
  });

  it(
    "--reap stops only processes whose cwd is inside the worktree",
    { skip: process.platform === "win32" },
    async () => {
      const box = sandbox();
      const tree = worktree(box, "served", "feat/served");
      const inside = sleeper(join(tree, "src"));
      const outside = sleeper(box.root);
      try {
        const plan = fm(box, ["wt", "clean", "--stale-days", "0", "--json"]);
        assert.equal(byBranch(box, plan, "feat/served").cls, "running");
        fm(box, ["wt", "clean", "--apply", "--reap", "--stale-days", "0", "--json"]);
        await exited(inside);
        assert.notEqual(inside.signalCode ?? inside.exitCode, null);
        assert.equal(outside.exitCode, null);
        assert.equal(outside.signalCode, null);
        assert.ok(!existsSync(tree));
      } finally {
        inside.kill("SIGKILL");
        outside.kill("SIGKILL");
        box.dispose();
      }
    },
  );
});

describe("wt list, doctor and purge", () => {
  it("lists class, owner, purpose and size, reports unregistered worktrees, and purges only expired refs", () => {
    const box = sandbox();
    try {
      const made = fm(box, ["wt", "new", "F1", "--purpose", "checkout", "--json"]);
      assert.equal(field(made, "ok"), true);
      worktree(box, "ide", "feat/ide");
      const listed = fm(box, ["wt", "list", "--json"]);
      const rows = field(listed, "data", "worktrees");
      assert.ok(Array.isArray(rows));
      const own: unknown = rows.find((row: unknown) => field(row, "id") === "F1");
      assert.equal(field(own, "class"), "locked");
      assert.equal(field(own, "purpose"), "checkout");
      assert.equal(field(own, "port"), 5174);
      assert.equal(typeof field(own, "exclusiveBytes"), "number");
      const doctor = fm(box, ["wt", "doctor", "--json"]);
      const findings = field(doctor, "data", "findings");
      assert.ok(Array.isArray(findings));
      assert.ok(findings.some((item) => field(item, "kind") === "unregistered"));
      const old = spawnSync("git", ["commit-tree", "HEAD^{tree}", "-m", "old"], {
        cwd: box.root,
        encoding: "utf8",
        env: { ...process.env, GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z" },
      }).stdout.trim();
      git(box.root, "update-ref", "refs/finitemonkey/archive/feat/old/1", old);
      git(box.root, "update-ref", "refs/finitemonkey/archive/feat/new/1", "HEAD");
      const expired = (body: unknown): readonly unknown[] => {
        const list = field(body, "data", "expired");
        assert.ok(Array.isArray(list));
        return list;
      };
      assert.equal(expired(fm(box, ["wt", "purge", "--json"])).length, 1);
      fm(box, ["wt", "purge", "--apply", "--json"]);
      assert.equal(
        git(box.root, "for-each-ref", "--format=%(refname)", "refs/finitemonkey/archive/"),
        "refs/finitemonkey/archive/feat/new/1",
      );
      git(box.root, "worktree", "unlock", join(box.root, ".claude", "worktrees", "F1"));
    } finally {
      box.dispose();
    }
  });
});
