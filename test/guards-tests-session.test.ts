import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { gitPostToolUse, gitSessionStart } from "../src/git/hooks/session.js";
import { testsGuard } from "../src/guards/tests/hook.js";
import { restoreOf } from "../src/guards/tests/restore.js";
import { bash, edit, git, hook, reasonOf, tempRepo, write } from "./git-support.js";

const NOTES_TEST = `const { test } = require("node:test");
const assert = require("node:assert");
const { handle } = require("../src/app.js");

const ana = { authorization: "Bearer token-ana" };

test("a signed-in user creates and reads a note", () => {
  const created = handle({ method: "POST", path: "/notes", headers: ana, body: { body: "buy milk" } });
  assert.equal(created.status, 201);
  const read = handle({ method: "GET", path: \`/notes/\${created.body.id}\`, headers: ana });
  assert.equal(read.body.body, "buy milk");
});

test("nobody gets in without a token", () => {
  assert.equal(handle({ method: "GET", path: "/notes" }).status, 401);
});
`;

const ANCHOR = 'test("nobody gets in without a token", () => {';

const ADDED = `const bia = { authorization: "Bearer token-bia" };

test("the owner edits a note", () => {
  const created = handle({ method: "POST", path: "/notes", headers: ana, body: { body: "by milk" } });
  const edited = handle({ method: "PATCH", path: \`/notes/\${created.body.id}\`, headers: ana, body: { body: "buy milk" } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.body, "buy milk");
});

test("another user cannot edit a note", () => {
  const created = handle({ method: "POST", path: "/notes", headers: ana, body: { body: "private" } });
  const edited = handle({ method: "PATCH", path: \`/notes/\${created.body.id}\`, headers: bia, body: { body: "hacked" } });
  assert.equal(edited.status, 404);
});

test("editing a missing note is a 404", () => {
  assert.equal(handle({ method: "PATCH", path: "/notes/999", headers: ana, body: { body: "x" } }).status, 404);
});

`;

const REPORT_TEST = `const { test } = require("node:test");
const assert = require("node:assert");
const { dailyTotals } = require("../src/report.js");

test("sums orders per day", () => {
  assert.deepEqual(dailyTotals([{ id: 1, at: "2026-01-10T12:00:00.000Z", cents: 100 }]), { "2026-01-10": 100 });
});
`;

const STORE_DAY_TEST = `const { test } = require("node:test");
const assert = require("node:assert");
const { dailyTotals } = require("../src/report.js");

test("counts late-evening orders on the store's own day", () => {
  const totals = dailyTotals([
    { id: 1, at: "2026-03-11T03:30:00.000Z", cents: 700 },
    { id: 2, at: "2026-03-11T05:59:00.000Z", cents: 300 },
  ]);
  assert.equal(totals["2026-03-10"], 1000);
});
`;

const SED_FIX = `sed -i 's/2026-03-11T/2026-01-11T/; s/"2026-03-10"/"2026-01-10"/; s/"2026-03-11"/"2026-01-11"/; s/Mar 10/Jan 10/; s/Mar 11/Jan 11/' test/store-day.test.js && sed -i 's/2026-03-11T/2026-01-11T/g' test/store-day.test.js && npm test 2>&1 | grep -E "^# (tests|pass|fail)"`;

const editCall = (path: string, oldString: string, newString: string): JsonObject => ({
  tool_name: "Edit",
  tool_input: { file_path: path, old_string: oldString, new_string: newString },
});

const sessionEdit = async (root: AbsolutePath, path: string, content: string): Promise<void> => {
  write(root, path, content);
  await hook(gitPostToolUse, "PostToolUse", root, edit(join(root, path)));
};

const guard = (root: AbsolutePath, raw: JsonObject) => hook(testsGuard, "PreToolUse", root, raw);

const notesSession = async () => {
  const repo = tempRepo({
    "src/app.js": "exports.handle = () => ({ status: 401 });\n",
    "test/notes.test.js": NOTES_TEST,
  });
  await hook(gitSessionStart, "SessionStart", repo.root);
  await sessionEdit(repo.root, "test/notes.test.js", NOTES_TEST.replace(ANCHOR, `${ADDED}${ANCHOR}`));
  return repo;
};

describe("tests guard: restoring a test file to its session-start content (notes-idor)", () => {
  it("allows the Edit that takes out the tests this session added", async () => {
    const repo = await notesSession();
    try {
      const decision = await guard(
        repo.root,
        editCall(join(repo.root, "test/notes.test.js"), `${ADDED}${ANCHOR}`, ANCHOR),
      );
      assert.equal(decision.kind, "allow", reasonOf(decision));
    } finally {
      repo.dispose();
    }
  });

  it("allows git checkout of the file, with and without --", async () => {
    const repo = await notesSession();
    try {
      const commands = [
        "git diff test/notes.test.js | grep '^+' | grep -v '^+++' | sed 's/^+//' > /tmp/new-tests.txt; git checkout test/notes.test.js && git status --short && wc -l /tmp/new-tests.txt",
        "git checkout -- test/notes.test.js && git status --short",
        "git restore test/notes.test.js",
        "git checkout HEAD -- test/notes.test.js",
      ];
      for (const command of commands) {
        const decision = await guard(repo.root, bash(command));
        assert.equal(decision.kind, "allow", `${command}: ${reasonOf(decision)}`);
      }
    } finally {
      repo.dispose();
    }
  });

  it("still blocks removing a test the project had", async () => {
    const repo = await notesSession();
    try {
      const path = join(repo.root, "test/notes.test.js");
      const removed = await guard(repo.root, editCall(path, ANCHOR, "const unused = () => {"));
      assert.equal(removed.kind, "block");
      assert.match(reasonOf(removed), /test removed in test\/notes\.test\.js/);
      for (const command of ["rm test/notes.test.js", "git rm -q test/notes.test.js"]) {
        const decision = await guard(repo.root, bash(command));
        assert.equal(decision.kind, "block", command);
      }
    } finally {
      repo.dispose();
    }
  });

  it("blocks a checkout whose source is not the session-start content", async () => {
    const repo = await notesSession();
    try {
      write(repo.root, "test/notes.test.js", NOTES_TEST.replace(/test\("nobody[\s\S]*$/, ""));
      git(repo.root, "add", "test/notes.test.js");
      write(repo.root, "test/notes.test.js", NOTES_TEST.replace(ANCHOR, `${ADDED}${ANCHOR}`));
      const decision = await guard(repo.root, bash("git checkout test/notes.test.js"));
      assert.equal(decision.kind, "block");
    } finally {
      repo.dispose();
    }
  });
});

describe("tests guard: a test file this session created (timezone-report)", () => {
  const session = async () => {
    const repo = tempRepo({
      "src/report.js": "exports.dailyTotals = () => ({});\n",
      "test/report.test.js": REPORT_TEST,
    });
    await hook(gitSessionStart, "SessionStart", repo.root);
    await sessionEdit(repo.root, "test/store-day.test.js", STORE_DAY_TEST);
    return repo;
  };

  it("allows the sed -i that fixes the sample dates in the session's own test", async () => {
    const repo = await session();
    try {
      const decision = await guard(repo.root, bash(SED_FIX));
      assert.equal(decision.kind, "allow", reasonOf(decision));
    } finally {
      repo.dispose();
    }
  });

  it("allows an Edit that rewrites the session's own test, but not one that adds a skip", async () => {
    const repo = await session();
    try {
      const path = join(repo.root, "test/store-day.test.js");
      const rewrite = await guard(repo.root, editCall(path, 'test("counts', 'test("sums'));
      assert.equal(rewrite.kind, "allow", reasonOf(rewrite));
      const skip = await guard(repo.root, editCall(path, 'test("counts', 'test.skip("counts'));
      assert.equal(skip.kind, "block");
    } finally {
      repo.dispose();
    }
  });

  it("still blocks the same sed on the project's test file", async () => {
    const repo = await session();
    try {
      const decision = await guard(repo.root, bash(SED_FIX.replaceAll("store-day", "report")));
      assert.equal(decision.kind, "block");
    } finally {
      repo.dispose();
    }
  });

  it("blocks a test that was already there, untracked, when the session started", async () => {
    const repo = tempRepo({ "src/report.js": "exports.dailyTotals = () => ({});\n" });
    try {
      write(repo.root, "test/store-day.test.js", STORE_DAY_TEST);
      await hook(gitSessionStart, "SessionStart", repo.root);
      await sessionEdit(repo.root, "test/store-day.test.js", `${STORE_DAY_TEST}\n`);
      const decision = await guard(repo.root, bash(SED_FIX));
      assert.equal(decision.kind, "block");
    } finally {
      repo.dispose();
    }
  });

  it("blocks when the session start was never recorded", async () => {
    const repo = tempRepo({ "src/report.js": "exports.dailyTotals = () => ({});\n" });
    try {
      write(repo.root, "test/store-day.test.js", STORE_DAY_TEST);
      const decision = await guard(repo.root, bash(SED_FIX));
      assert.equal(decision.kind, "block");
    } finally {
      repo.dispose();
    }
  });
});

describe("tests guard: reading a restore command", () => {
  const isTree = (rev: string): boolean => rev === "HEAD" || rev === "main";
  const of = (argv: readonly string[]) => restoreOf({ env: {}, argv, redirects: [] }, isTree);
  const cases = [
    [["git", "checkout", "test/a.test.js"], { source: undefined, paths: ["test/a.test.js"] }],
    [["git", "checkout", "--", "test/a.test.js"], { source: undefined, paths: ["test/a.test.js"] }],
    [["git", "checkout", "main", "test/a.test.js"], { source: "main", paths: ["test/a.test.js"] }],
    [["git", "checkout", "HEAD", "--", "test/a.test.js"], { source: "HEAD", paths: ["test/a.test.js"] }],
    [["git", "restore", "-s", "HEAD", "test/a.test.js"], { source: "HEAD", paths: ["test/a.test.js"] }],
    [["git", "restore", "--source=main", "test/a.test.js"], { source: "main", paths: ["test/a.test.js"] }],
    [["git", "restore", "--staged", "--worktree", "test/a.test.js"], { source: "HEAD", paths: ["test/a.test.js"] }],
    [["git", "checkout", "-p", "test/a.test.js"], undefined],
    [["git", "checkout", "-b", "feat/1-x"], undefined],
    [["sed", "-i", "s/a/b/", "test/a.test.js"], undefined],
  ] as const;
  for (const [argv, expected] of cases) {
    it(argv.join(" "), () => {
      assert.deepEqual(of(argv), expected);
    });
  }
});
