import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import { parseCritique } from "../src/review/findings.js";
import { outcomeOf, type ReproRun } from "../src/review/reproduce.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field, ROOT } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const finding = (group: string, extra: Readonly<Record<string, unknown>> = {}) => ({
  group,
  what: "w",
  problem: "p",
  fix: "f",
  ifNotFixed: "i",
  ...extra,
});

describe("a must-fix finding needs a reproduction command", () => {
  it("without a command and an expected result it counts as should fix", () => {
    const parsed = parseCritique({
      verdict: "request-changes",
      findings: [
        finding("must"),
        finding("must", { repro: { command: "npm test", expect: "" } }),
        finding("must", { repro: { command: "npm test", expect: "exits 1" } }),
      ],
    });
    assert.ok(!Array.isArray(parsed) && "findings" in parsed);
    assert.deepEqual(
      parsed.findings.map((item) => [item.group, item.demoted]),
      [
        ["should", true],
        ["should", true],
        ["must", false],
      ],
    );
  });

  it("rejects a finding without the four parts and an unknown verdict", () => {
    assert.deepEqual(parseCritique({ verdict: "ship it", findings: [{ group: "nice", what: "w" }] }), [
      "verdict must be one of approve, approve-with-changes, request-changes",
      "finding 1 is missing problem, fix, ifNotFixed",
    ]);
  });
});

const run = (side: "base" | "head", exitCode: number | null): ReproRun => ({
  finding: 1,
  rev: side,
  side,
  command: "x",
  exitCode,
  at: "2026-10-26T00:00:00.000Z",
});

describe("reproduction outcomes", () => {
  it("classifies head only, both and neither", () => {
    assert.equal(outcomeOf(run("base", 0), run("head", 1)), "head-only");
    assert.equal(outcomeOf(run("base", 1), run("head", 1)), "already-there");
    assert.equal(outcomeOf(run("base", 0), run("head", 0)), "not-reproduced");
    assert.equal(outcomeOf(run("base", 1), run("head", 0)), "not-reproduced");
    assert.equal(outcomeOf(run("base", 0), run("head", null)), "not-run");
  });
});

const CHECK = [
  "const { readFileSync } = require('node:fs');",
  "const [file, word] = process.argv.slice(2);",
  "process.exit(readFileSync(file, 'utf8').includes(word) ? 1 : 0);",
  "",
].join("\n");

const critique = {
  verdict: "request-changes",
  findings: [
    finding("must", { what: "new bug", repro: { command: "node check.cjs a.txt newbug", expect: "exits 1" } }),
    finding("must", {
      what: "old bug",
      activeRisk: true,
      repro: { command: "node check.cjs a.txt oldbug", expect: "exits 1" },
    }),
    finding("must", { what: "imagined bug", repro: { command: "node check.cjs a.txt ghost", expect: "exits 1" } }),
    finding("nice", { what: "naming" }),
  ],
};

describe("critique verify runs each must fix on base and head in throwaway worktrees", () => {
  it("keeps head-only, moves both to already there, drops neither, and prints both results", async () => {
    const repo = makeRepo({ "check.cjs": CHECK, "a.txt": "oldbug\n" });
    repos.push(repo);
    repo.git("switch", "-q", "-c", "feat");
    repo.write("a.txt", "oldbug\nnewbug\n");
    repo.commit("feat: change a");
    const stdin = Readable.from([JSON.stringify(critique)]);
    const result = await cliJson(["critique", "verify", "--base", "main"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: {},
      stdin,
    });
    assert.equal(result.code, 1);
    const checked = field(result.body, "data", "checked");
    const settled = Array.isArray(checked) ? checked.map((item) => field(item, "settled")) : [];
    assert.deepEqual(settled, ["must", "already-there", "not-reproduced", "nice"]);
    const text = await cli(["critique", "verify", "--base", "main"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: {},
      stdin: Readable.from([JSON.stringify(critique)]),
    });
    assert.match(
      text.stdout,
      /\| 1 \| `node check\.cjs a\.txt newbug` \| exit 0 \| exit 1 \| fails only on head: kept \|/,
    );
    assert.match(
      text.stdout,
      /\| 2 \| `node check\.cjs a\.txt oldbug` \| exit 1 \| exit 1 \| fails on both: already there \|/,
    );
    assert.match(
      text.stdout,
      /\| 3 \| `node check\.cjs a\.txt ghost` \| exit 0 \| exit 0 \| fails on neither: not reproduced \|/,
    );
    assert.match(text.stdout, /Decision needed: finding 2 \(old bug\)/);
    assert.equal(repo.git("worktree", "list").trim().split("\n").length, 1);
    assert.equal(repo.read("a.txt"), "oldbug\nnewbug\n");
  });
});

describe("the critique skill", () => {
  const BUILT_IN = new Set([
    "add-dir",
    "agents",
    "batch",
    "bug",
    "clear",
    "compact",
    "config",
    "context",
    "cost",
    "debug",
    "doctor",
    "exit",
    "export",
    "feedback",
    "help",
    "hooks",
    "ide",
    "init",
    "insights",
    "install-github-app",
    "login",
    "logout",
    "loop",
    "mcp",
    "memory",
    "model",
    "permissions",
    "plugin",
    "pr-comments",
    "release-notes",
    "resume",
    "review",
    "rewind",
    "security-review",
    "simplify",
    "status",
    "statusline",
    "terminal-setup",
    "todos",
    "upgrade",
    "usage",
    "vim",
  ]);

  it("no plugin skill or agent shares a name with a built-in command", () => {
    const skills = readdirSync(join(ROOT, "plugin", "skills"));
    const agents = readdirSync(join(ROOT, "plugin", "agents")).map((name) => name.replace(/\.md$/, ""));
    assert.ok(skills.includes("critique"));
    for (const name of [...skills, ...agents]) assert.ok(!BUILT_IN.has(name), `${name} collides with /${name}`);
  });
});
