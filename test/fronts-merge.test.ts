import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { EVIDENCE_SCHEMA } from "../src/evidence/types.js";
import { type Front, readFronts, serializeState } from "../src/fronts/state.js";
import { gitAt, treeHash } from "../src/gate/git.js";
import { git, runtime, tempDir, tempRepo, write } from "./git-support.js";
import { hunksOf, merge, sandbox, sides } from "./merge-support.js";
import { BUNDLE, field, parseBody } from "./support.js";

const ROUTES = 'export const routes = [\n  "/home",\n];\n';
const LOCALE = '{\n  "app": {\n    "title": "Home"\n  }\n}\n';
const FNS = "export function a() {\n  return 0;\n}\n";

interface Planted {
  readonly route: string;
  readonly key: string;
  readonly fn: string;
}

const PLANTS: Readonly<Record<string, Planted>> = {
  F1: { route: "/checkout", key: "checkout", fn: "b" },
  F2: { route: "/invites", key: "invites", fn: "c" },
  F3: { route: "/report", key: "report", fn: "d" },
};

const plant = (path: string, id: string): void => {
  const item = PLANTS[id];
  assert.ok(item);
  write(path, "src/routes.ts", ROUTES.replace('"/home",', `"/home",\n  "${item.route}",`));
  write(path, "src/locales/en.json", LOCALE.replace('"Home"', `"Home",\n    "${item.key}": "${item.key}"`));
  write(path, "src/fns.ts", `${FNS}\nexport function ${item.fn}() {\n  return 1;\n}\n`);
  for (const name of ["page", "form", "list"]) write(path, `src/${item.key}/${name}.ts`, `export const ${name} = 1;\n`);
};

const frontOf = (id: string, path: string, blockedBy: readonly string[]): Front => ({
  id,
  goal: id,
  contract: null,
  paths: [`src/${PLANTS[id]?.key ?? id}/**`],
  append: ["src/routes.ts"],
  i18nNs: PLANTS[id]?.key ?? null,
  worktree: id,
  path,
  branch: `front/${id}`,
  port: null,
  shotsPrefix: null,
  issue: null,
  agentId: `agent-${id}`,
  agentKind: "subagent",
  status: "reported",
  blockedBy,
  inbox: [],
  lastReport: null,
  costUsd: 0,
  startedAt: null,
});

const reportFor = (path: string, id: string, passed: number): void => {
  const tree = treeHash(gitAt(runtime, toAbsolutePath(path))) ?? "";
  const entry = {
    schema: EVIDENCE_SCHEMA,
    task: id,
    check: "tests",
    kind: "tests",
    status: "passed",
    treeHash: tree,
    at: "2026-10-27T10:00:00Z",
    notes: [],
    testCount: 41,
  };
  write(path, `.finitemonkey/evidence/${id}.jsonl`, `${JSON.stringify(entry)}\n`);
  const report = {
    front: id,
    branch: `front/${id}`,
    head: git(path, "rev-parse", "HEAD"),
    commits: [],
    delivered: [`${id} screen`],
    endpoints: [],
    tests: { command: "npm test", passed, failed: 0, added: 3 },
    screenshots: [],
    left_out: [],
    provisional_decisions:
      id === "F2"
        ? [{ decision: "invites expire in 7 days", options: ["7", "30"], recommendation: "7", needs_human: true }]
        : [],
    evidence: `.finitemonkey/evidence/${id}.jsonl`,
  };
  write(path, `.finitemonkey/reports/${id}.json`, JSON.stringify(report));
};

interface Wave {
  readonly root: AbsolutePath;
  readonly home: AbsolutePath;
  readonly paths: Readonly<Record<string, string>>;
  readonly dispose: () => void;
}

const waveOf = (claimed: Readonly<Record<string, number>> = {}): Wave => {
  const repo = tempRepo({ "src/routes.ts": ROUTES, "src/locales/en.json": LOCALE, "src/fns.ts": FNS });
  const home = tempDir("fm-wave-home-");
  const paths: Record<string, string> = {};
  for (const id of ["F1", "F2", "F3"]) {
    const path = `${repo.root}-${id}`;
    paths[id] = path;
    git(repo.root, "worktree", "add", "-q", path, "-b", `front/${id}`);
    plant(path, id);
    git(path, "add", "-A");
    git(path, "commit", "-q", "-m", `feat: ${id}`);
    reportFor(path, id, claimed[id] ?? 41);
  }
  const fronts = [
    frontOf("F1", paths["F1"] ?? "", []),
    frontOf("F2", paths["F2"] ?? "", []),
    frontOf("F3", paths["F3"] ?? "", ["F1"]),
  ];
  const base = git(repo.root, "rev-parse", "--short=7", "HEAD");
  write(
    repo.root,
    ".finitemonkey/fronts.yml",
    serializeState({
      wave: 1,
      base: `main@${base}`,
      briefing: ".finitemonkey/briefing.md",
      maxConcurrent: 3,
      budgetUsd: null,
      budgetMinutes: null,
      fronts,
      pending: [],
    }),
  );
  return {
    root: repo.root,
    home,
    paths,
    dispose: () => {
      repo.dispose();
      rmSync(home, { recursive: true, force: true });
      for (const path of Object.values(paths)) rmSync(path, { recursive: true, force: true });
    },
  };
};

const frontsMerge = (wave: Wave): JsonObject => {
  const result = spawnSync(process.execPath, [BUNDLE, "fronts", "merge", "--json"], {
    cwd: wave.root,
    encoding: "utf8",
    env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], HOME: wave.home, USERPROFILE: wave.home },
    timeout: 240000,
  });
  return parseBody(result.stdout);
};

describe("fronts merge", () => {
  it("a wave of three fronts with planted conflicts merges into wave/1 without intervention", () => {
    const wave = waveOf();
    try {
      const body = frontsMerge(wave);
      assert.equal(field(body, "ok"), true, JSON.stringify(field(body, "error")));
      const routes = git(wave.root, "show", "wave/1:src/routes.ts");
      for (const route of ["/home", "/checkout", "/invites", "/report"]) assert.match(routes, new RegExp(`"${route}"`));
      assert.deepEqual(
        Object.keys(
          (JSON.parse(git(wave.root, "show", "wave/1:src/locales/en.json")) as { app: JsonObject }).app,
        ).sort(),
        ["checkout", "invites", "report", "title"],
      );
      const fns = git(wave.root, "show", "wave/1:src/fns.ts");
      assert.equal(fns.split("\n").filter((line) => line === "}").length, 4);
      const merges = field(body, "data", "merges");
      assert.ok(Array.isArray(merges));
      assert.deepEqual(
        merges.map((item: unknown) => field(item, "front")),
        ["F1", "F2", "F3"],
      );
      const state = readFronts(runtime, wave.root);
      assert.ok(state.ok);
      assert.ok(state.value.fronts.every((front) => front.status === "merged"));
      for (const path of Object.values(wave.paths)) assert.ok(!existsSync(path), path);
      assert.equal(git(wave.root, "rev-list", "--count", "main"), "1");
    } finally {
      wave.dispose();
    }
  });

  it("a report with a false number fails the wave before anything merges", () => {
    const wave = waveOf({ F2: 50 });
    try {
      const body = frontsMerge(wave);
      assert.equal(field(body, "error", "code"), "fronts_merge_failed");
      assert.match(String(field(body, "error", "message")), /F2: tests: the report claims 50 tests, the ledger ran 41/);
      assert.equal(spawnSync("git", ["rev-parse", "--verify", "--quiet", "wave/1"], { cwd: wave.root }).status, 1);
    } finally {
      wave.dispose();
    }
  });
});

describe("per-file policies are class hints", () => {
  const page = 'export const title = "Home";\nexport const footer = "2025";\n';

  it("prefer-front keeps the front only when it already has the other side's change", () => {
    const box = sandbox({
      "src/pages/home.ts": page,
      ".finitemonkey/config.yml": 'merge:\n  policies:\n    "src/pages/**": prefer-front\n',
    });
    try {
      sides(
        box,
        { "src/pages/home.ts": page.replace('"Home"', '"Home!"') },
        { "src/pages/home.ts": page.replace('"Home";', '"Home!";\nexport const subtitle = "Hi";') },
      );
      const report = merge(box);
      assert.deepEqual(hunksOf(report, "src/pages/home.ts"), [{ cls: "C8", rule: "exclusive-scope-theirs" }]);
    } finally {
      box.dispose();
    }
  });

  it("prefer-front and keep-both never override a C7", () => {
    const box = sandbox({
      "src/pages/home.ts": page,
      "src/routes.ts": ROUTES,
      ".finitemonkey/config.yml":
        'merge:\n  policies:\n    "src/pages/**": prefer-front\n    "src/routes.ts": keep-both\n',
    });
    try {
      sides(
        box,
        {
          "src/pages/home.ts": page.replace('"Home"', '"Home (fixed)"'),
          "src/routes.ts": ROUTES.replace('"/home"', '"/start"'),
        },
        {
          "src/pages/home.ts": page.replace('"Home"', '"Start"'),
          "src/routes.ts": ROUTES.replace('"/home"', '"/begin"'),
        },
      );
      const report = merge(box);
      assert.equal(report["outcome"], "stopped");
      assert.deepEqual(hunksOf(report, "src/pages/home.ts"), [
        { cls: "C7", rule: "exclusive-scope-would-lose-other-side" },
      ]);
      assert.deepEqual(hunksOf(report, "src/routes.ts"), [{ cls: "C7", rule: "same-lines-changed" }]);
      const files = report["files"];
      assert.ok(Array.isArray(files));
      assert.deepEqual(files.map((file: unknown) => field(file, "hint")).sort(), ["keep-both", "prefer-front"]);
    } finally {
      box.dispose();
    }
  });
});
