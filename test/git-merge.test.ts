import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { verifyMerge, type VerifyReport } from "../src/git/merge/verify.js";
import { openRepo } from "../src/git/repo.js";
import { git, runtime, tempRepo, write } from "./git-support.js";

interface Scenario {
  readonly base: string;
  readonly ours: string;
  readonly theirs: string;
  readonly result: string;
  readonly dropped?: string;
}

const FILE = "src/registry.ts";

const mergeWith = (scenario: Scenario): VerifyReport => {
  const repo = tempRepo({ [FILE]: scenario.base });
  try {
    git(repo.root, "switch", "-q", "-c", "theirs");
    write(repo.root, FILE, scenario.theirs);
    git(repo.root, "commit", "-q", "-am", "theirs");
    git(repo.root, "switch", "-q", "main");
    write(repo.root, FILE, scenario.ours);
    git(repo.root, "commit", "-q", "-am", "ours");
    spawnSync("git", ["merge", "-q", "--no-edit", "theirs"], { cwd: repo.root, encoding: "utf8" });
    write(repo.root, FILE, scenario.result);
    if (scenario.dropped !== undefined) write(repo.root, ".finitemonkey/merge-dropped.json", scenario.dropped);
    git(repo.root, "add", FILE);
    git(repo.root, "commit", "-q", "--no-edit");
    const opened = openRepo(runtime, toAbsolutePath(repo.root));
    assert.ok(opened);
    return verifyMerge(runtime, opened, { rev: "HEAD" });
  } finally {
    repo.dispose();
  }
};

const REGISTRY_BASE = `export const ENDPOINTS = {
  users: {
    list: "/users",
  },
};
`;

const REGISTRY_OURS = `export const ENDPOINTS = {
  users: {
    list: "/users",
  },
  orders: {
    list: "/orders",
  },
};
`;

const REGISTRY_THEIRS = `export const ENDPOINTS = {
  users: {
    list: "/users",
  },
  plans: {
    list: "/plans",
  },
};
`;

const REGISTRY_BOTH = `export const ENDPOINTS = {
  users: {
    list: "/users",
  },
  orders: {
    list: "/orders",
  },
  plans: {
    list: "/plans",
  },
};
`;

const REGISTRY_LOST_BRACE = `export const ENDPOINTS = {
  users: {
    list: "/users",
  },
  orders: {
    list: "/orders",
  plans: {
    list: "/plans",
  },
};
`;

const FUNCTIONS_BASE = "export const a = () => {\n  return 1;\n};\n";
const FUNCTIONS_OURS = `${FUNCTIONS_BASE}\nexport const b = () => {\n  return 2;\n};\n`;
const FUNCTIONS_THEIRS = `${FUNCTIONS_BASE}\nexport const c = () => {\n  return 3;\n};\n`;

describe("merge verify (nothing lost)", () => {
  it("passes when both sides append to the same registry and both survive", () => {
    const report = mergeWith({
      base: REGISTRY_BASE,
      ours: REGISTRY_OURS,
      theirs: REGISTRY_THEIRS,
      result: REGISTRY_BOTH,
    });
    assert.equal(report.exit, 0, JSON.stringify(report.findings));
  });

  it("fails a union resolution that dropped a closing brace in the registry", () => {
    const report = mergeWith({
      base: REGISTRY_BASE,
      ours: REGISTRY_OURS,
      theirs: REGISTRY_THEIRS,
      result: REGISTRY_LOST_BRACE,
    });
    assert.equal(report.exit, 1);
    assert.ok(
      report.findings.some((finding) => finding.file === FILE && finding.weak && finding.text === "}"),
      JSON.stringify(report.findings),
    );
  });

  it("fails when one side's registry entry is gone", () => {
    const report = mergeWith({
      base: REGISTRY_BASE,
      ours: REGISTRY_OURS,
      theirs: REGISTRY_THEIRS,
      result: REGISTRY_OURS,
    });
    assert.equal(report.exit, 1);
    assert.ok(report.findings.some((finding) => finding.side === "theirs" && finding.text.includes("/plans")));
  });

  it("passes when both sides append after a last entry that had no trailing comma", () => {
    const base = "export const LIMITS = {\n  a: 1\n};\n";
    const report = mergeWith({
      base,
      ours: "export const LIMITS = {\n  a: 1,\n  b: 2\n};\n",
      theirs: "export const LIMITS = {\n  a: 1,\n  c: 3\n};\n",
      result: "export const LIMITS = {\n  a: 1,\n  b: 2,\n  c: 3\n};\n",
    });
    assert.equal(report.exit, 0, JSON.stringify(report.findings));
  });

  it("reports the first lost line of a partially kept hunk at its own line number", () => {
    const report = mergeWith({
      base: "a\n",
      ours: "a\n\nfoo\nbar\n",
      theirs: "a\nbaz\n",
      result: "a\n\nfoo\nbaz\n",
    });
    assert.equal(report.exit, 1);
    const lost = report.findings.find((finding) => finding.kind === "missing-addition");
    assert.ok(lost, JSON.stringify(report.findings));
    assert.equal(lost.text, "bar");
    assert.equal(lost.side, "ours");
    assert.equal(lost.line, 4);
  });

  it("fails when a closing brace between new functions of both sides is lost (case 7)", () => {
    const result = `${FUNCTIONS_BASE}\nexport const b = () => {\n  return 2;\n\nexport const c = () => {\n  return 3;\n};\n`;
    const report = mergeWith({ base: FUNCTIONS_BASE, ours: FUNCTIONS_OURS, theirs: FUNCTIONS_THEIRS, result });
    assert.equal(report.exit, 1);
    assert.ok(
      report.findings.some((finding) => finding.weak),
      JSON.stringify(report.findings),
    );
  });

  it("honors a removal on one side next to an addition on the other (case 5)", () => {
    const base = "Ana\nJill\nZoe\n";
    const ours = "Ana\nZoe\n";
    const theirs = "Ana\nJill\nJared\nZoe\n";
    assert.equal(mergeWith({ base, ours, theirs, result: "Ana\nJared\nZoe\n" }).exit, 0);
    const kept = mergeWith({ base, ours, theirs, result: "Ana\nJill\nJared\nZoe\n" });
    assert.equal(kept.exit, 1);
    assert.ok(
      kept.findings.some((finding) => finding.kind === "removal-not-honored"),
      JSON.stringify(kept.findings),
    );
  });

  it("accepts the lost side only when the dropped file justifies it with a known reason", () => {
    const scenario = { base: REGISTRY_BASE, ours: REGISTRY_OURS, theirs: REGISTRY_THEIRS, result: REGISTRY_OURS };
    const justified = mergeWith({
      ...scenario,
      dropped: JSON.stringify({ dropped: [{ file: FILE, side: "theirs", reason: "human_decision" }] }),
    });
    assert.equal(justified.exit, 0, JSON.stringify(justified.findings));
    assert.ok(justified.justified > 0);
    const invalid = mergeWith({
      ...scenario,
      dropped: JSON.stringify({ dropped: [{ file: FILE, side: "theirs", reason: "looked fine" }] }),
    });
    assert.equal(invalid.exit, 1);
    assert.ok(invalid.findings.some((finding) => finding.kind === "invalid-dropped"));
  });
});
