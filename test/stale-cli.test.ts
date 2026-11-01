import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { appendEvidence } from "../src/evidence/ledger.js";
import { EVIDENCE_SCHEMA } from "../src/evidence/types.js";
import { fmPaths } from "../src/task/paths.js";
import { type GhScript, makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, execResult, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const repo = (files: Readonly<Record<string, string>>): Repo => {
  const made = makeRepo(files);
  repos.push(made);
  return made;
};

const DOCS = {
  "README.md": "# App\n\n- `finitemonkey recap` (planned).\n- `finitemonkey teleport` (planned).\n",
  "docs/essay.md": "| Mechanism | Status |\n|---|---|\n| Drift sensor | In development (#12) |\n",
  "CHANGELOG.md": "# Changelog\n\n## [1.2.0](https://example.com) (2026-10-01)\n",
  "src/app.ts": "export const app = 1;\n",
};

const ghIssues =
  (issues: string, milestones = "[]"): GhScript =>
  (args) => {
    if (args[0] === "issue" && args[1] === "list") return execResult(0, issues);
    if (args[0] === "issue" && args[1] === "view")
      return execResult(0, '{"closedByPullRequestsReferences":[{"number":40}]}');
    if (args[0] === "api") return execResult(0, milestones);
    return undefined;
  };

const stale = (items: unknown): readonly unknown[] => (Array.isArray(items) ? items : []);

describe("finitemonkey stale", () => {
  it("reports a planned command that exists and leaves issues unchecked offline", async () => {
    const target = repo(DOCS);
    const run = await cliJson(["stale"], { cwd: target.root, runtime: repoRuntime() });
    assert.equal(run.code, 0);
    const claims = stale(field(run.body, "data", "stale"));
    assert.deepEqual(
      claims.map((claim) => [field(claim, "file"), field(claim, "line"), field(claim, "subject")]),
      [["README.md", 3, "finitemonkey recap"]],
    );
    assert.equal(field(run.body, "data", "schema"), "finitemonkey/stale@1");
    assert.equal(field(run.body, "data", "mode"), "shadow");
    assert.deepEqual(field(run.body, "data", "unresolvedIssues"), [12]);
  });

  it("checks issues with gh when asked and names the pull request that closed it", async () => {
    const target = repo(DOCS);
    const runtime = repoRuntime({ gh: ghIssues('[{"number":12,"state":"CLOSED","stateReason":"COMPLETED"}]') });
    const run = await cliJson(["stale", "--online"], { cwd: target.root, runtime });
    const issue = stale(field(run.body, "data", "stale")).find((claim) => field(claim, "truth") === "issue_closed");
    assert.equal(field(issue, "file"), "docs/essay.md");
    assert.equal(field(issue, "detail"), "#40");
    assert.match(String(field(issue, "evidence")), /closed as completed by #40/);
  });

  it("lists issues closed by commits but still open, and empty milestones, after a merge", async () => {
    const target = repo(DOCS);
    target.git("tag", "v1.2.0");
    target.write("src/app.ts", "export const app = 2;\n");
    target.commit("feat: sensor\n\nCloses #12");
    const runtime = repoRuntime({
      gh: ghIssues(
        '[{"number":12,"state":"OPEN","stateReason":""}]',
        '[{"number":3,"title":"Stage 3","open_issues":0,"closed_issues":4}]',
      ),
    });
    const run = await cliJson(["stale", "--after-merge"], { cwd: target.root, runtime });
    assert.equal(run.code, 0);
    assert.equal(field(run.body, "data", "range"), "v1.2.0..HEAD");
    const unclosed = stale(field(run.body, "data", "unclosedIssues"));
    assert.deepEqual(
      unclosed.map((item) => field(item, "issue")),
      [12],
    );
    assert.deepEqual(
      stale(field(run.body, "data", "emptyMilestones")).map((item) => field(item, "title")),
      ["Stage 3"],
    );
  });

  it("fails closed and says why when gh cannot answer", async () => {
    const target = repo(DOCS);
    const run = await cliJson(["stale", "--online"], { cwd: target.root, runtime: repoRuntime() });
    assert.notEqual(run.code, 0);
    assert.equal(field(run.body, "error", "code"), "stale_lookup_failed");
  });

  it("lists docs that mention what the branch touched", async () => {
    const target = repo({ ...DOCS, "docs/app.md": "The entry point is src/app.ts.\n" });
    target.git("switch", "-q", "-c", "feat/77-app");
    target.write("src/app.ts", "export const app = 3;\n");
    target.commit("feat: app");
    const run = await cliJson(["stale", "--diff", "main"], { cwd: target.root, runtime: repoRuntime() });
    const mentions = stale(field(run.body, "data", "mentions"));
    assert.deepEqual(
      mentions.map((item) => [field(item, "file"), field(item, "mentions")]),
      [["docs/app.md", ["src/app.ts"]]],
    );
  });
});

describe("pr open lists what the change makes stale", () => {
  it("adds the section to the body", async () => {
    const target = repo({ ...DOCS, "docs/app.md": "The `appVersion` export lives in src/app.ts (#77).\n" });
    target.git("switch", "-q", "-c", "feat/77-app");
    target.write("src/app.ts", "export const appVersion = 3;\n");
    target.commit("feat: app version\n\nCloses #77");
    const run = await cliJson(["pr", "open", "--dry-run"], { cwd: target.root, runtime: repoRuntime() });
    const body = String(field(run.body, "data", "body"));
    assert.match(body, /## What this change makes stale/);
    assert.match(body, /`docs\/app\.md:1` mentions `src\/app\.ts`, `appVersion`, `#77`/);
  });
});

const recordingRuntime = (calls: ExecRequest[]): Runtime => {
  const base = repoRuntime();
  return {
    ...base,
    exec: (request) => {
      calls.push(request);
      return base.exec(request);
    },
  };
};

describe("finitemonkey recap", () => {
  it("prints shipped features, open items and stale docs from fixtures without calling a model", async () => {
    const target = repo(DOCS);
    target.write("src/sensor.ts", "export const sensor = 1;\n");
    target.commit("feat(drift): the `drift-sensor` flag reads session logs");
    const calls: ExecRequest[] = [];
    const runtime = recordingRuntime(calls);
    const paths = fmPaths(target.root);
    const at = new Date().toISOString();
    appendEvidence(runtime, paths.evidence("t1"), [
      {
        schema: EVIDENCE_SCHEMA,
        task: "t1",
        check: "*state*",
        kind: "state",
        status: "passed",
        treeHash: "abc",
        at,
        notes: [],
        state: "verified",
        from: "unverified",
      },
    ]);
    target.write(".finitemonkey/state.json", '{"schemaVersion":1,"active":"t2","done":["t1"]}\n');
    target.write(
      join(".finitemonkey", "decision-records", "t1.json"),
      JSON.stringify({ task: "t1", at, changes: [{ class: "dependency", detail: "+left-pad" }] }),
    );
    const run = await cliJson(["recap", "--since", "7d"], { cwd: target.root, runtime });
    assert.equal(run.code, 0);
    const data = field(run.body, "data");
    assert.deepEqual(
      stale(field(data, "tasksFinished")).map((item) => field(item, "task")),
      ["t1"],
    );
    const shipped = stale(field(data, "shipped"));
    assert.equal(field(shipped[0], "subject"), "the `drift-sensor` flag reads session logs");
    assert.deepEqual(field(shipped[0], "features"), [{ id: "drift-sensor", mode: "shadow" }]);
    assert.deepEqual(field(data, "inShadow"), ["drift-sensor"]);
    assert.equal(field(data, "activeTask"), "t2");
    assert.deepEqual(
      stale(field(data, "decisions")).map((item) => field(item, "changes")),
      [["+left-pad"]],
    );
    assert.equal(stale(field(data, "staleDocs")).length, 1);
    assert.deepEqual(calls, []);
  });

  it("refuses a period it cannot read", async () => {
    const target = repo(DOCS);
    const run = await cliJson(["recap", "--since", "soon"], { cwd: target.root, runtime: repoRuntime() });
    assert.notEqual(run.code, 0);
    assert.equal(field(run.body, "error", "code"), "invalid_arguments");
  });
});
