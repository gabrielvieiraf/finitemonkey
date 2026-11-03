import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { isRecord } from "../src/core/parsed.js";
import { fetchBase, fetchNotes } from "../src/merge/fetch.js";
import { mergeFormatter } from "../src/merge/format.js";
import { git, runtime, tempDir, write } from "./git-support.js";
import { commitOn, hunksOf, merge, resultFile, sandbox, sides } from "./merge-support.js";

const FORMATTER =
  'import { readFileSync, writeFileSync } from "node:fs";\nfor (const file of process.argv.slice(2)) writeFileSync(file, readFileSync(file, "utf8").replace(/\\s*$/, "\\n// formatted\\n"));\n';

const ACTIVE = (guard: string): string => `guards:\n  ${guard}: active\n`;

const filesOf = (report: Record<string, unknown>): readonly Record<string, unknown>[] =>
  Array.isArray(report["files"]) ? report["files"].filter(isRecord) : [];

describe("merge: formatter on C3, tested candidates and fetch of the base", () => {
  it("runs the project formatter on a C3 result and records it as a check", () => {
    const box = sandbox({
      "fmt.mjs": FORMATTER,
      "src/f.ts": "export function f(a, b) { return a + b; }\n",
      ".finitemonkey/config.yml": 'merge:\n  formatter: "node fmt.mjs"\n',
    });
    try {
      sides(
        box,
        { "src/f.ts": "export function f(a, b) {\n  return a + b;\n}\n" },
        { "src/f.ts": "export function f(a, b) { return a * b; }\n" },
      );
      const report = merge(box);
      assert.equal(report["outcome"], "merged", JSON.stringify(report["stops"]));
      assert.deepEqual(hunksOf(report, "src/f.ts"), [{ cls: "C3", rule: "ours-only-formatted" }]);
      assert.match(resultFile(box, report, "src/f.ts"), /a \* b; }\n\/\/ formatted/);
      const checks = Array.isArray(report["checks"]) ? report["checks"].filter(isRecord) : [];
      assert.deepEqual(
        checks.filter((check) => check["name"] === "format").map((check) => check["ok"]),
        [true],
      );
    } finally {
      box.dispose();
    }
  });

  it("without a formatter in config.yml nothing extra runs", () => {
    assert.equal(mergeFormatter({}), undefined);
    assert.equal(mergeFormatter({ merge: { formatter: "  npx prettier --write " } }), "npx prettier --write");
  });

  const learned = (checkCode: number, active: boolean) => {
    const box = sandbox({ "src/a.ts": "export const a = 1;\n" });
    sides(box, { "src/a.ts": "export const a = 2;\n" }, { "src/a.ts": "export const a = 3;\n" });
    const taught = spawnSync("git", ["-c", "rerere.enabled=true", "merge", "-q", "feat/x"], { cwd: box.root });
    assert.notEqual(taught.status, 0);
    write(box.root, "src/a.ts", "export const a = 5;\n");
    git(box.root, "add", "-A");
    git(box.root, "-c", "rerere.enabled=true", "commit", "-q", "--no-edit");
    git(box.root, "reset", "-q", "--hard", "HEAD~1");
    if (active) write(box.root, ".finitemonkey/policy.yml", ACTIVE("merge-candidates"));
    const report = merge(box, "--check", `node -e "process.exit(${String(checkCode)})"`);
    return { box, file: filesOf(report).find((item) => item["path"] === "src/a.ts") };
  };

  it("a remembered resolution is proposed only after its checks pass in a throwaway worktree", () => {
    const passed = learned(0, true);
    const failed = learned(1, true);
    const shadow = learned(1, false);
    try {
      const fields = [passed, failed, shadow].map((item) => [item.file?.["proposalTest"], item.file?.["proposal"]]);
      assert.deepEqual(fields, [
        ["passed", "rerere"],
        ["failed", null],
        [undefined, "rerere"],
      ]);
      const trees = git(passed.box.root, "worktree", "list");
      assert.doesNotMatch(trees, /merge-candidate/);
    } finally {
      for (const item of [passed, failed, shadow]) item.box.dispose();
    }
  });

  it("fetches the target's upstream first and notes when the base moved", () => {
    const remote = sandbox({ "README.md": "one\n" });
    const clone = tempDir("fm-merge-clone-");
    try {
      git(clone, "clone", "-q", remote.root, ".");
      commitOn(remote, "main", { "README.md": "two\n" });
      const root = toAbsolutePath(clone);
      assert.equal(fetchBase(runtime, root, "main"), undefined);
      write(clone, ".finitemonkey/policy.yml", ACTIVE("merge-fetch"));
      const fetched = fetchBase(runtime, root, "main");
      assert.deepEqual(fetched, { upstream: "origin/main", fetched: true, behind: 1 });
      assert.deepEqual(fetchNotes(fetched, "main"), [
        "base moved: origin/main is 1 commits ahead of main; merged into the local main",
      ]);
      assert.deepEqual(fetchNotes({ upstream: "origin/main", fetched: true, behind: 0 }, "main"), []);
    } finally {
      remote.dispose();
      rmSync(clone, { recursive: true, force: true });
    }
  });
});
