import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { plainMergeAbort } from "../src/merge/abort-hook.js";
import { bash, git, hook } from "./git-support.js";
import { commitOn, hunksOf, merge, resultFile, ROUTES, sandbox, sides } from "./merge-support.js";

describe("merge protocol: scope, bases and plain merges", () => {
  it("case 9: a page owned by one front with a fix from the other side turns C8 into C7", () => {
    const page = 'export const title = "Home";\nexport const footer = "2025";\n';
    const box = sandbox({
      "src/pages/home.ts": page,
      "contracts/target.yml": "scope:\n  paths: [src/shared/**]\n",
      "contracts/source.yml": "scope:\n  paths: [src/pages/**]\n",
    });
    try {
      sides(
        box,
        { "src/pages/home.ts": page.replace('"Home"', '"Home (fixed)"') },
        { "src/pages/home.ts": page.replace('"Home"', '"Start"') },
      );
      const report = merge(
        box,
        "--target-contract",
        "contracts/target.yml",
        "--source-contract",
        "contracts/source.yml",
      );
      assert.equal(report["outcome"], "stopped");
      assert.deepEqual(hunksOf(report, "src/pages/home.ts"), [
        { cls: "C7", rule: "exclusive-scope-would-lose-other-side" },
      ]);
    } finally {
      box.dispose();
    }
  });

  it("C8 keeps the owning side when it already carries the other side's change", () => {
    const page = 'export const title = "Home";\nexport const footer = "2025";\n';
    const box = sandbox({
      "src/pages/home.ts": page,
      "contracts/target.yml": "scope:\n  paths: [src/shared/**]\n",
      "contracts/source.yml": "scope:\n  paths: [src/pages/**]\n",
    });
    try {
      sides(
        box,
        { "src/pages/home.ts": page.replace('"Home"', '"Home!"') },
        { "src/pages/home.ts": page.replace('"Home";', '"Home!";\nexport const subtitle = "Hi";') },
      );
      const report = merge(
        box,
        "--target-contract",
        "contracts/target.yml",
        "--source-contract",
        "contracts/source.yml",
      );
      assert.equal(report["outcome"], "merged", JSON.stringify(report["stops"]));
      assert.deepEqual(hunksOf(report, "src/pages/home.ts"), [{ cls: "C8", rule: "exclusive-scope-theirs" }]);
    } finally {
      box.dispose();
    }
  });

  it("case 15: a criss-cross merge is marked and merged against the virtual base", () => {
    const box = sandbox({ "src/routes.ts": ROUTES, "a.txt": "a\n", "b.txt": "b\n" });
    try {
      commitOn(box, "feat/x", { "b.txt": "b2\n" }, "main");
      commitOn(box, "main", { "a.txt": "a2\n" });
      const mainTip = git(box.root, "rev-parse", "main");
      git(box.root, "merge", "-q", "--no-edit", "feat/x");
      git(box.root, "switch", "-q", "feat/x");
      git(box.root, "merge", "-q", "--no-edit", mainTip);
      commitOn(box, "feat/x", { "src/routes.ts": ROUTES.replace('"/home",', '"/home",\n  "/b",') });
      commitOn(box, "main", { "src/routes.ts": ROUTES.replace('"/home",', '"/home",\n  "/a",') });
      const report = merge(box);
      const bases = report["bases"];
      assert.ok(Array.isArray(bases));
      assert.equal(bases.length, 2);
      assert.equal(report["virtualBase"], true);
      assert.equal(report["outcome"], "merged", JSON.stringify(report["stops"]));
      assert.match(resultFile(box, report, "src/routes.ts"), /"\/a",\n {2}"\/b",/);
    } finally {
      box.dispose();
    }
  });
});

describe("merge protocol: plain git merge outside the protocol", () => {
  it("a conflicting git merge is snapshotted and aborted, with the right command in context", async () => {
    const box = sandbox({ "src/math.ts": "export const x = 1;\n" });
    try {
      sides(box, { "src/math.ts": "export const x = 2;\n" }, { "src/math.ts": "export const x = 3;\n" });
      spawnSync("git", ["merge", "feat/x"], { cwd: box.root, encoding: "utf8" });
      const decision = await hook(plainMergeAbort, "PostToolUse", box.root, bash("git merge feat/x"));
      assert.equal(spawnSync("git", ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], { cwd: box.root }).status, 1);
      assert.match(JSON.stringify(decision), /finitemonkey merge/);
      assert.match(git(box.root, "for-each-ref", "refs/finitemonkey/backup/"), /plain-merge-with-conflicts/);
      assert.equal(git(box.root, "diff", "--name-only", "--diff-filter=U"), "");
      assert.equal(git(box.root, "status", "--porcelain", "--", "src"), "");
    } finally {
      box.dispose();
    }
  });
});
