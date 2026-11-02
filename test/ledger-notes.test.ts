import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { parseJsonObject } from "../src/core/parsed.js";
import type { Runtime } from "../src/core/runtime.js";
import { ledgerHead, NOTES_REF } from "../src/evidence/notes.js";
import { ensureKey, signLine } from "../src/evidence/sign.js";
import { runGate } from "../src/gate/run.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
const homes: string[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const homeRuntime = (): Runtime => {
  const home = mkdtempSync(join(tmpdir(), "fm-home-"));
  homes.push(home);
  return { ...repoRuntime(), homeDir: () => home };
};

const fresh = (runtime: Runtime): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
  repos.push(repo);
  const created = createTask(runtime, fmPaths(repo.root), {
    id: "t1",
    goal: "change a",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [],
    tests: "node --test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  repo.write("src/a.js", "export const a = 2;\n");
  return repo;
};

const gate = (repo: Repo, runtime: Runtime) => {
  const run = runGate({ runtime, cwd: repo.root, env: {}, sessionId: "s1", budgetMs: 60_000, fast: false });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  return run.report;
};

const resign = (runtime: Runtime, line: string): string => {
  const parsed = parseJsonObject(line);
  assert.ok(parsed.ok);
  const entry = Object.fromEntries(Object.entries(parsed.value).filter(([name]) => name !== "kid" && name !== "sig"));
  const key = ensureKey(runtime);
  assert.ok(key !== undefined);
  return signLine(key, { ...entry, at: "2020-01-01T00:00:00.000Z" });
};

describe("ledger head in git notes", () => {
  it("chains the hash over the lines so any change in a prefix changes the head", () => {
    assert.equal(ledgerHead("a\nb\n").lines, 2);
    assert.equal(ledgerHead("a\nb\nc\n", 2).head, ledgerHead("a\nb\n").head);
    assert.notEqual(ledgerHead("a\nB\n").head, ledgerHead("a\nb\n").head);
  });

  it("a rewritten older ledger line is reported against the git notes even when it is signed with the key", () => {
    const runtime = homeRuntime();
    const repo = fresh(runtime);
    const first = gate(repo, runtime);
    assert.equal(first.rewritten, undefined);
    const note = repo.git("notes", `--ref=${NOTES_REF}`, "show", "HEAD");
    assert.match(note, /finitemonkey\/ledger-note@1/);
    const path = fmPaths(repo.root).evidence("t1");
    const [head = "", ...rest] = readFileSync(path, "utf8").split("\n");
    writeFileSync(path, [resign(runtime, head), ...rest].join("\n"));
    const second = gate(repo, runtime);
    assert.equal(second.tampered, 0, "the forged line carries a valid signature");
    assert.ok(second.rewritten !== undefined && second.rewritten > 0);
    assert.match(readFileSync(fmPaths(repo.root).log, "utf8"), /"event":"ledger_rewritten"/);
  });

  it("appending to the ledger after a note is not a rewrite", () => {
    const runtime = homeRuntime();
    const repo = fresh(runtime);
    gate(repo, runtime);
    repo.write("src/a.js", "export const a = 3;\n");
    assert.equal(gate(repo, runtime).rewritten, undefined);
  });
});
