import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AbsolutePath } from "../src/core/brand.js";
import { CONFLICT_SUFFIX, readManifest } from "../src/git/file-store.js";
import { openRepo, type Repo } from "../src/git/repo.js";
import { storeName, takeSnapshot } from "../src/git/snapshot.js";
import { snapshotViews, undoSnapshot } from "../src/git/undo.js";
import { git, runtime, tempRepo, write } from "./git-support.js";

const opened = (root: AbsolutePath): Repo => {
  const repo = openRepo(runtime, root);
  assert.ok(repo);
  return repo;
};

const newest = (repo: Repo) => {
  const [view] = snapshotViews(runtime, repo);
  assert.ok(view);
  return view;
};

const project = () =>
  tempRepo({
    "README.md": "hello\n",
    ".gitignore": ".env\ndata/\nnode_modules/\n",
    "src/a.ts": "export const a = 1;\n",
  });

describe("snapshots keep ignored and untracked files", () => {
  it("git clean -fdx followed by undo brings back .env and ignored data", () => {
    const repo = project();
    try {
      write(repo.root, ".env", "API_KEY=local-only\n");
      write(repo.root, "data/rows.csv", "id\n1\n");
      write(repo.root, "node_modules/x/index.js", "module.exports = 1;\n");
      const taken = takeSnapshot(runtime, opened(repo.root), { op: "clean" });
      assert.ok(taken.ok);
      git(repo.root, "clean", "-fdxq");
      assert.equal(existsSync(join(repo.root, ".env")), false);
      const undone = undoSnapshot(runtime, opened(repo.root), newest(opened(repo.root)), "in-place");
      assert.ok(undone.ok);
      assert.equal(readFileSync(join(repo.root, ".env"), "utf8"), "API_KEY=local-only\n");
      assert.equal(readFileSync(join(repo.root, "data/rows.csv"), "utf8"), "id\n1\n");
      assert.equal(existsSync(join(repo.root, "node_modules/x/index.js")), false, "dependency folders are skipped");
    } finally {
      repo.dispose();
    }
  });

  it("a snapshot over the cap lists what it skipped", () => {
    const repo = project();
    try {
      write(repo.root, ".env", "API_KEY=local-only\n");
      write(repo.root, "data/big.bin", "x".repeat(4096));
      const taken = takeSnapshot(runtime, opened(repo.root), { op: "clean", capBytes: 1024 });
      assert.ok(taken.ok);
      const manifest = readManifest(runtime, opened(repo.root), storeName(taken.value.ref));
      assert.ok(manifest);
      assert.deepEqual(
        manifest.files.map((file) => file.path),
        [".env"],
      );
      assert.deepEqual(
        manifest.skipped.filter((item) => item.reason === "cap").map((item) => item.path),
        ["data/big.bin"],
      );
      assert.equal(taken.value.skipped, 1);
    } finally {
      repo.dispose();
    }
  });

  it("restore never overwrites a file changed after the snapshot", () => {
    const repo = project();
    try {
      write(repo.root, ".env", "API_KEY=old\n");
      assert.ok(takeSnapshot(runtime, opened(repo.root), { op: "manual" }).ok);
      writeFileSync(join(repo.root, ".env"), "API_KEY=new\n");
      const undone = undoSnapshot(runtime, opened(repo.root), newest(opened(repo.root)), "in-place");
      assert.ok(undone.ok);
      assert.deepEqual(undone.value.conflicts, [".env"]);
      assert.equal(readFileSync(join(repo.root, ".env"), "utf8"), "API_KEY=new\n");
      assert.equal(readFileSync(join(repo.root, `.env${CONFLICT_SUFFIX}`), "utf8"), "API_KEY=old\n");
    } finally {
      repo.dispose();
    }
  });
});
