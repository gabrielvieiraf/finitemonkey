import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";

import type { AbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { type Front, serializeState } from "../src/fronts/state.js";
import { tempDir, tempRepo, write } from "./git-support.js";
import { BUNDLE, field, parseBody, ROOT } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures", "plan");

const ISSUES = [
  { number: 70, title: "worktree registry", state: "OPEN" },
  { number: 71, title: "wt clean", state: "OPEN" },
];

const fakeGh = (dir: string, script: string): void => {
  writeFileSync(join(dir, "gh.mjs"), script);
  writeFileSync(join(dir, "gh"), `#!/bin/sh\nexec node "${join(dir, "gh.mjs").replace(/\\/g, "/")}" "$@"\n`);
  chmodSync(join(dir, "gh"), 0o755);
  writeFileSync(join(dir, "gh.cmd"), `@node "%~dp0gh.mjs" %*\r\n`);
};

const run = (
  root: AbsolutePath,
  bin: string,
  args: readonly string[],
): { readonly code: number | null; readonly body: JsonObject } => {
  const result = spawnSync(process.execPath, [BUNDLE, ...args, "--json"], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
      SystemRoot: process.env["SystemRoot"],
      HOME: bin,
      USERPROFILE: bin,
    },
    timeout: 60000,
  });
  return { code: result.status, body: parseBody(result.stdout) };
};

const layered = (fixture: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    ["valid", fixture].flatMap((name) =>
      readdirSync(join(FIXTURES, name)).map((file) => [
        `docs/plan/${file}`,
        readFileSync(join(FIXTURES, name, file), "utf8"),
      ]),
    ),
  );

const kinds = (body: JsonObject): readonly string[] => {
  const issues = field(body, "data", "issues");
  return Array.isArray(issues) ? issues.map((item: unknown) => String(field(item, "kind"))) : [];
};

describe("plan check against the task map", () => {
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ["task-map-valid", []],
    ["task-map-missing-row", ["issue_without_row"]],
    ["task-map-stray-row", ["row_without_issue"]],
  ];
  for (const [fixture, expected] of cases) {
    it(`${fixture} gives ${expected.join(", ") || "no issue"}`, () => {
      const repo = tempRepo({ "README.md": "# app\n", ...layered(fixture) });
      const bin = tempDir("fm-sync-bin-");
      try {
        write(repo.root, ".finitemonkey/cache/issues.json", JSON.stringify({ at: "x", source: "gh", issues: ISSUES }));
        const result = run(repo.root, bin, ["plan", "check"]);
        assert.deepEqual(kinds(result.body), expected);
        assert.equal(result.code, expected.length === 0 ? 0 : 1);
      } finally {
        repo.dispose();
        rmSync(bin, { recursive: true, force: true });
      }
    });
  }
});

const front: Front = {
  id: "F1",
  goal: "registry",
  contract: null,
  paths: ["src/wt/**"],
  append: [],
  i18nNs: null,
  worktree: "F1",
  path: null,
  branch: "front/F1",
  port: null,
  shotsPrefix: null,
  issue: 70,
  agentId: null,
  agentKind: "subagent",
  status: "reported",
  blockedBy: [],
  inbox: [],
  lastReport: ".finitemonkey/reports/F1.json",
  costUsd: 0,
  startedAt: null,
};

const withWave = (root: AbsolutePath): void => {
  write(
    root,
    ".finitemonkey/fronts.yml",
    serializeState({
      wave: 1,
      base: "main@abc",
      briefing: ".finitemonkey/briefing.md",
      maxConcurrent: 3,
      budgetUsd: null,
      budgetMinutes: null,
      fronts: [front],
      pending: [],
    }),
  );
};

describe("fronts sync", () => {
  it("reads the issues through gh, links the fronts and writes the task map", () => {
    const repo = tempRepo();
    const bin = tempDir("fm-sync-bin-");
    try {
      withWave(repo.root);
      fakeGh(bin, `console.log(${JSON.stringify(JSON.stringify(ISSUES))});\n`);
      const result = run(repo.root, bin, ["fronts", "sync"]);
      assert.equal(result.code, 0, JSON.stringify(result.body));
      assert.equal(field(result.body, "data", "source"), "github");
      const map = readFileSync(join(repo.root, "docs", "plan", "01-task-map.md"), "utf8");
      assert.match(map, /\| #70 \| worktree registry \| F1 \| reported \| \.finitemonkey\/reports\/F1\.json \|/);
      assert.match(map, /\| #71 \| wt clean \| - \| open \| - \|/);
      assert.match(readFileSync(join(repo.root, ".finitemonkey", "cache", "issues.json"), "utf8"), /"number": 71/);
    } finally {
      repo.dispose();
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("works without network, keeping the local map", () => {
    const repo = tempRepo();
    const bin = tempDir("fm-sync-bin-");
    try {
      withWave(repo.root);
      write(
        repo.root,
        "docs/plan/03-task-map.md",
        "| Issue | Title | Front | State | Report |\n|---|---|---|---|---|\n| #70 | worktree registry | - | open | - |\n| #88 | sync | - | open | - |\n",
      );
      fakeGh(bin, 'console.error("error connecting to api.github.com"); process.exit(1);\n');
      for (const args of [
        ["fronts", "sync"],
        ["fronts", "sync", "--offline"],
      ]) {
        const result = run(repo.root, bin, args);
        assert.equal(result.code, 0, JSON.stringify(result.body));
        assert.equal(field(result.body, "data", "source"), "local");
        const map = readFileSync(join(repo.root, "docs", "plan", "03-task-map.md"), "utf8");
        assert.match(map, /\| #70 \| worktree registry \| F1 \| reported \|/);
        assert.match(map, /\| #88 \| sync \| - \| open \| - \|/);
      }
    } finally {
      repo.dispose();
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
