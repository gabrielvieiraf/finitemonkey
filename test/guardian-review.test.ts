import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { renderDecision } from "../src/decide/template.js";
import { readDecisions } from "../src/guardian/decisions.js";
import { guardianReview } from "../src/guardian/review.js";
import { createTranslator } from "../src/i18n/translate.js";
import { fmPaths } from "../src/task/paths.js";
import { denied, fireHook, policyWith, tty } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const t = createTranslator("en");
const ACCEPTED_AT = new Date(Date.now() - 3_600_000).toISOString();
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const record = (topic: string, recommendation: string, delta: string): string =>
  renderDecision(t, topic, "2026-10-20")
    .replace("- **Recommendation:**", `- **Recommendation:** ${recommendation}`)
    .replace("|  |  |  |", "| Settles in one day | 5 | product owner |")
    .replace("## Proof\n", "## Proof\n\nFACT: the provider settles Pix on D+0 (https://example.com/pix, 2026-10-20)\n")
    .replace("- Modified:", `- Modified: ${delta}`);

describe("guardian decisions", () => {
  it("holds a model write of status: accepted, lets proposed through and starts in shadow", async () => {
    const repo = makeRepo({
      "docs/plan/02-decision-queue.md": record("queue", "keep cron", "src/jobs/"),
      ".finitemonkey/policy.yml": policyWith({ "decision-hold": "active" }),
    });
    repos.push(repo);
    const file = `${repo.root}/docs/plan/02-decision-queue.md`;
    const edit = (oldText: string, newText: string) =>
      fireHook(repo, "PreToolUse", {
        tool_name: "Edit",
        tool_input: { file_path: file, old_string: oldText, new_string: newText },
      });
    assert.equal(denied(await edit("status: proposed", "status: accepted")), true);
    assert.equal(denied(await edit("## Status\n\nproposed", "## Status\n\naccepted")), true);
    const fresh = await fireHook(repo, "PreToolUse", {
      tool_name: "Write",
      tool_input: { file_path: `${repo.root}/docs/plan/05-decision-cache.md`, content: record("cache", "x", "y") },
    });
    assert.equal(denied(fresh), false);
    repo.write(".finitemonkey/policy.yml", "level: standard\n");
    assert.equal(denied(await edit("status: proposed", "status: accepted")), false);
  });

  it("only the person accepts, and only a proposed record", async () => {
    const repo = makeRepo({ "docs/plan/02-decision-queue.md": record("queue", "keep cron", "src/jobs/") });
    repos.push(repo);
    const runtime = repoRuntime({ now: () => "2026-10-21T10:00:00.000Z" });
    const agent = await cli(["decide", "accept", "docs/plan/02-decision-queue.md"], {
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
      stdin: tty(),
      runtime,
    });
    assert.notEqual(agent.code, 0);
    const person = await cliJson(
      ["decide", "accept", "docs/plan/02-decision-queue.md", "--choice", "use a queue", "--reason", "cron misses jobs"],
      { cwd: repo.root, stdin: tty(), runtime },
    );
    assert.equal(person.code, 0);
    assert.equal(field(person.body, "data", "entry", "decision"), "overridden");
    assert.match(repo.read("docs/plan/02-decision-queue.md"), /status: accepted[\s\S]*## Status\n\naccepted/);
    const again = await cli(["decide", "accept", "docs/plan/02-decision-queue.md"], {
      cwd: repo.root,
      stdin: tty(),
      runtime,
    });
    assert.notEqual(again.code, 0);
  });

  it("attaches a revert and gate failures to the decision whose area they touched", async () => {
    const repo = makeRepo({
      "docs/plan/02-decision-queue.md": record("queue", "keep cron", "src/jobs/"),
      "docs/plan/03-decision-cache.md": record("cache", "no cache", "src/cache/"),
      "src/jobs/run.ts": "export const run = 1;\n",
      "src/cache/store.ts": "export const store = 1;\n",
      ".finitemonkey/tasks/jobs.yml":
        "id: jobs\ngoal: jobs\nscope:\n  paths: [src/jobs/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n",
      ".finitemonkey/evidence/jobs.jsonl": `${JSON.stringify({
        schema: "finitemonkey/evidence@1",
        task: "jobs",
        check: "*gate*",
        kind: "gate",
        status: "failed",
        treeHash: "x",
        at: new Date().toISOString(),
        notes: [],
      })}\n`,
    });
    repos.push(repo);
    const runtime = repoRuntime({ now: () => ACCEPTED_AT });
    for (const name of ["02-decision-queue.md", "03-decision-cache.md"])
      assert.equal(
        (await cli(["decide", "accept", `docs/plan/${name}`], { cwd: repo.root, stdin: tty(), runtime })).code,
        0,
      );
    repo.write("src/jobs/run.ts", "export const run = 2;\n");
    repo.commit('Revert "jobs: switch runner"');
    const review = guardianReview(repoRuntime(), fmPaths(repo.root));
    const bySubject = new Map(review.rows.map((row) => [row.subject, row] as const));
    assert.equal(bySubject.get("docs/plan/02-decision-queue.md")?.outcome.reverted.length, 1);
    assert.equal(bySubject.get("docs/plan/02-decision-queue.md")?.outcome.gateFailures, 1);
    assert.deepEqual(bySubject.get("docs/plan/03-decision-cache.md")?.outcome, { reverted: [], gateFailures: 0 });
    assert.equal(bySubject.get("docs/plan/02-decision-queue.md")?.process.evidence, 1);
    const shown = await cli(["guardian", "review"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(shown.stdout, /process[\s\S]*outcome/i);
  });

  it("the person can forget an entry", async () => {
    const repo = makeRepo({ "docs/plan/02-decision-queue.md": record("queue", "keep cron", "src/jobs/") });
    repos.push(repo);
    const runtime = repoRuntime();
    await cli(["decide", "accept", "docs/plan/02-decision-queue.md"], { cwd: repo.root, stdin: tty(), runtime });
    assert.equal(readDecisions(runtime, fmPaths(repo.root)).length, 1);
    const forgot = await cli(["guardian", "forget", "d1"], { cwd: repo.root, stdin: tty(), runtime });
    assert.equal(forgot.code, 0);
    assert.equal(readDecisions(runtime, fmPaths(repo.root)).length, 0);
  });
});
