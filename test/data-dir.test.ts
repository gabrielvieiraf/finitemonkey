import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { dataDirFor, dataDirState } from "../src/core/data-dir-layout.js";
import { type DataDirFs, ensureIgnored, migrateDataDir, prepareDataDir } from "../src/core/data-dir-migrate.js";
import { nodeDataDirFs, nodeDirProbe } from "../src/core/data-dir-node.js";

const LEGACY = ".finitemonkey";

const project = (): string => {
  const root = mkdtempSync(join(tmpdir(), "fm-data-dir-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
};

const legacyProject = (): string => {
  const root = project();
  mkdirSync(join(root, LEGACY, "evidence"), { recursive: true });
  writeFileSync(join(root, LEGACY, "evidence", "t1.jsonl"), '{"gate":"pass"}\n');
  writeFileSync(join(root, LEGACY, "state.json"), "{}\n");
  return root;
};

describe("data directory migration", () => {
  it("renames an existing .finitemonkey to .fm and keeps the evidence", () => {
    const root = legacyProject();
    assert.equal(migrateDataDir(nodeDataDirFs, root), "renamed");
    assert.equal(existsSync(join(root, LEGACY)), false);
    assert.equal(readFileSync(join(root, ".fm", "evidence", "t1.jsonl"), "utf8"), '{"gate":"pass"}\n');
    assert.equal(dataDirFor(dataDirState(nodeDirProbe, root)), ".fm");
  });

  it("keeps reading .finitemonkey when the rename fails", () => {
    const root = legacyProject();
    const locked: DataDirFs = { ...nodeDataDirFs, rename: () => false };
    assert.equal(migrateDataDir(locked, root), "rename_failed");
    assert.equal(readFileSync(join(root, LEGACY, "evidence", "t1.jsonl"), "utf8"), '{"gate":"pass"}\n');
    assert.equal(dataDirFor(dataDirState(nodeDirProbe, root)), LEGACY);
  });

  it("leaves a vendored install in .finitemonkey, since its hooks point there", () => {
    const root = legacyProject();
    mkdirSync(join(root, LEGACY, "runtime"));
    assert.equal(migrateDataDir(nodeDataDirFs, root), "vendored");
    assert.equal(dataDirFor(dataDirState(nodeDirProbe, root)), LEGACY);
  });

  it("keeps using .finitemonkey when .fm is a foreign file", () => {
    const root = legacyProject();
    writeFileSync(join(root, ".fm"), "someone else's file\n");
    assert.equal(migrateDataDir(nodeDataDirFs, root), "foreign");
    assert.equal(readFileSync(join(root, ".fm"), "utf8"), "someone else's file\n");
    assert.equal(dataDirFor(dataDirState(nodeDirProbe, root)), LEGACY);
  });

  it("keeps using .finitemonkey when .fm is a directory of another tool", () => {
    const root = legacyProject();
    mkdirSync(join(root, ".fm"));
    writeFileSync(join(root, ".fm", "settings.toml"), "x = 1\n");
    assert.equal(migrateDataDir(nodeDataDirFs, root), "foreign");
    assert.equal(existsSync(join(root, LEGACY, "state.json")), true);
    assert.equal(dataDirFor(dataDirState(nodeDirProbe, root)), LEGACY);
  });

  it("uses .fm in a project that has neither", () => {
    const root = project();
    assert.equal(migrateDataDir(nodeDataDirFs, root), "none");
    assert.equal(dataDirFor(dataDirState(nodeDirProbe, root)), ".fm");
  });
});

describe("data directory in .gitignore", () => {
  it("appends .fm/* once, without rewriting the file", () => {
    const root = legacyProject();
    writeFileSync(join(root, ".gitignore"), "node_modules/");
    prepareDataDir(nodeDataDirFs, root);
    assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), "node_modules/\n.fm/*\n");
    assert.equal(ensureIgnored(nodeDataDirFs, root), "skipped");
    writeFileSync(join(root, ".fm", "state.json"), "{}\n");
    assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), "node_modules/\n.fm/*\n");
  });

  it("adds nothing when git already ignores the directory", () => {
    const root = project();
    mkdirSync(join(root, ".fm"));
    writeFileSync(join(root, ".gitignore"), "# finitemonkey:begin v=1\n.fm/*\n!.fm/config.yml\n# finitemonkey:end\n");
    assert.equal(ensureIgnored(nodeDataDirFs, root), "ignored");
    assert.equal(readFileSync(join(root, ".gitignore"), "utf8").match(/^\.fm\/\*$/gm)?.length, 1);
  });

  it("does not touch .gitignore when .fm belongs to another tool", () => {
    const root = project();
    writeFileSync(join(root, ".fm"), "x\n");
    assert.equal(ensureIgnored(nodeDataDirFs, root), "skipped");
    assert.equal(existsSync(join(root, ".gitignore")), false);
  });
});
