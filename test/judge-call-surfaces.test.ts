import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { GATE_JUDGE_REQUEST, JUDGE_PANE_REQUEST, judgeProcess } from "../src/judge/call.js";
import { gateJudgeCall } from "../src/judge/gate-call.js";
import { appendEntry } from "../src/judge/store.js";
import { judgeLines } from "../src/mod/judge-view.js";
import { fmPaths } from "../src/task/paths.js";
import { tempDir, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cli, field, parseBody, ROOT, stdinFrom } from "./support.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const SKILL = join(ROOT, "plugin", "skills", "research", "SKILL.md");
const PLUGIN_SCRIPT = join(ROOT, "plugin", "scripts", "finitemonkey.mjs");

const project = (): TempRepo => {
  const repo = tempRepo({ "README.md": "hello\n" });
  repos.push(repo);
  write(repo.root, ".fm/policy.yml", "guards:\n  judge-core: shadow\n");
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  const base = { cause: "failed-in-use", support: "machine-verified", bands: {}, sources: [] };
  appendEntry(runtime, paths, {
    type: "event",
    id: "v1",
    at: "2026-10-20T10:00:00Z",
    claim: "k1",
    state: "open",
    ...base,
  });
  appendEntry(runtime, paths, {
    type: "event",
    id: "v1",
    at: "2026-10-21T10:00:00Z",
    claim: "k1",
    state: "open",
    fixedBy: "revert",
    fixedCommit: "abc1234",
    ...base,
  });
  appendEntry(runtime, paths, {
    type: "event",
    id: "v2",
    at: "2026-10-22T10:00:00Z",
    claim: "k2",
    state: "held",
    fixedBy: "person",
    ...base,
  });
  return repo;
};

const skillCall = (): { readonly stdin: string; readonly args: readonly string[] } => {
  const match = /echo '([^']+)' \| node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/finitemonkey\.mjs" ([^\n]+)/.exec(
    readFileSync(SKILL, "utf8"),
  );
  return { stdin: match?.[1] ?? "", args: (match?.[2] ?? "").trim().split(/\s+/) };
};

describe("one judge request through the CLI, the pane, the skill and the shipped script", () => {
  it("gives byte-identical JSON", async () => {
    const repo = project();
    const pane = judgeProcess(JUDGE_PANE_REQUEST);
    const skill = skillCall();
    assert.equal(skill.stdin, pane.stdin);
    assert.deepEqual(skill.args, pane.args);
    const viaPane = await cli(pane.args, { cwd: repo.root, runtime: repoRuntime(), stdin: stdinFrom(pane.stdin) });
    const viaSkill = await cli(skill.args, { cwd: repo.root, runtime: repoRuntime(), stdin: stdinFrom(skill.stdin) });
    assert.equal(viaPane.code, 0, viaPane.stdout);
    assert.equal(viaSkill.stdout, viaPane.stdout);
    const viaVerb = await cli(["judge", "trajectory", "--json"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(
      JSON.stringify(field(parseBody(viaVerb.stdout), "data")),
      JSON.stringify(field(parseBody(viaPane.stdout), "data")),
    );
    const home = tempDir("fm-home-");
    after(() => {
      rmSync(home, { recursive: true, force: true });
    });
    const shipped = spawnSync(process.execPath, [PLUGIN_SCRIPT, ...pane.args], {
      cwd: repo.root,
      input: pane.stdin,
      encoding: "utf8",
      env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], HOME: home, USERPROFILE: home },
      timeout: 20000,
    });
    assert.equal(shipped.status, 0, shipped.stderr);
    assert.equal(
      JSON.stringify(field(parseBody(shipped.stdout), "data")),
      JSON.stringify(field(parseBody(viaPane.stdout), "data")),
    );
  });

  it("the gate reads the same judge call JSON as the CLI, byte for byte", async () => {
    const repo = project();
    const gate = judgeProcess(GATE_JUDGE_REQUEST);
    const viaCli = await cli(gate.args, { cwd: repo.root, runtime: repoRuntime(), stdin: stdinFrom(gate.stdin) });
    assert.equal(viaCli.code, 0, viaCli.stdout);
    const viaGate = gateJudgeCall({ runtime: repoRuntime(), paths: fmPaths(repo.root) });
    assert.equal(JSON.stringify(viaGate), JSON.stringify(field(parseBody(viaCli.stdout), "data")));
  });

  it("the pane marks a revert and a person's fix differently", async () => {
    const repo = project();
    const pane = judgeProcess(JUDGE_PANE_REQUEST);
    const run = await cli(pane.args, { cwd: repo.root, runtime: repoRuntime(), stdin: stdinFrom(pane.stdin) });
    assert.deepEqual(judgeLines(run.stdout), [
      "↺ k1  failed-in-use  fixed by revert in abc1234  2026-10-21",
      "◆ k2  failed-in-use  fixed by person  2026-10-22",
    ]);
  });
});
