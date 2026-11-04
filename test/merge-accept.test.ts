import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { acceptFindings } from "../src/git/merge/dropped-accept.js";
import { blockLines } from "../src/git/merge/generated-blocks.js";
import { verifyMerge, type VerifyReport } from "../src/git/merge/verify.js";
import { openRepo } from "../src/git/repo.js";
import { git, runtime, tempRepo, write } from "./git-support.js";

const FILE = "README.md";

const doc = (intro: string, block: readonly string[]): string =>
  [intro, "", "<!-- generated:table:start -->", ...block, "<!-- generated:table:end -->", ""].join("\n");

interface Merged {
  readonly report: VerifyReport;
  readonly accept: (reason: string) => ReturnType<typeof acceptFindings>;
  readonly again: () => VerifyReport;
  readonly dispose: () => void;
}

const merged = (base: string, ours: string, theirs: string, result: string): Merged => {
  const repo = tempRepo({ [FILE]: base });
  git(repo.root, "switch", "-q", "-c", "theirs");
  write(repo.root, FILE, theirs);
  git(repo.root, "commit", "-q", "-am", "theirs");
  git(repo.root, "switch", "-q", "main");
  write(repo.root, FILE, ours);
  git(repo.root, "commit", "-q", "-am", "ours");
  spawnSync("git", ["merge", "-q", "--no-edit", "theirs"], { cwd: repo.root, encoding: "utf8" });
  write(repo.root, FILE, result);
  git(repo.root, "add", FILE);
  git(repo.root, "commit", "-q", "--no-edit");
  const root = toAbsolutePath(repo.root);
  const opened = openRepo(runtime, root);
  assert.ok(opened);
  const verify = (): VerifyReport => verifyMerge(runtime, opened, { rev: "HEAD" });
  const report = verify();
  return {
    report,
    accept: (reason) => acceptFindings(runtime, root, report.findings, reason),
    again: verify,
    dispose: repo.dispose,
  };
};

describe("merge verify and generated blocks", () => {
  it("splits lines inside generated markers from hand-written ones", () => {
    const lines = blockLines(doc("Hand line", ["| a | 1 |"]));
    assert.ok(lines.inside.has("| a | 1 |"));
    assert.ok(lines.outside.has("Hand line"));
    assert.ok(!lines.outside.has("| a | 1 |"));
  });

  it("does not count lines of a regenerated block as dropped", () => {
    const run = merged(
      doc("Intro", ["| a | 1 |"]),
      doc("Intro", ["| a | 2 |"]),
      doc("Intro", ["| a | 3 |"]),
      doc("Intro", ["| a | 4 |"]),
    );
    try {
      assert.equal(run.report.exit, 0, JSON.stringify(run.report.findings));
    } finally {
      run.dispose();
    }
  });

  it("still reports a hand-written line the merge dropped", () => {
    const run = merged(
      doc("Intro", ["| a | 1 |"]),
      doc("Intro from ours", ["| a | 1 |"]),
      doc("Intro from theirs", ["| a | 1 |"]),
      doc("Intro from ours", ["| a | 1 |"]),
    );
    try {
      assert.equal(run.report.exit, 1);
      assert.ok(run.report.findings.some((finding) => finding.text === "Intro from theirs"));
    } finally {
      run.dispose();
    }
  });
});

describe("merge verify --accept", () => {
  const dropping = (): Merged => merged("Intro\n", "Intro from ours\n", "Intro from theirs\n", "Intro from ours\n");

  it("records the open findings so the next verify passes, once", () => {
    const run = dropping();
    try {
      const first = run.accept("same_intent_other_side");
      assert.ok(first.ok && first.value > 0);
      assert.equal(run.again().exit, 0);
      const second = run.accept("mesma_intencao_outro_lado");
      assert.deepEqual(second, { ok: true, value: 0 });
    } finally {
      run.dispose();
    }
  });

  it("leaves the person-only reason and unknown reasons to the person", () => {
    const run = dropping();
    try {
      assert.equal(run.accept("decisao_humana").ok, false);
      assert.equal(run.accept("human_decision").ok, false);
      assert.equal(run.accept("looked fine").ok, false);
      assert.equal(run.again().exit, 1);
    } finally {
      run.dispose();
    }
  });
});
