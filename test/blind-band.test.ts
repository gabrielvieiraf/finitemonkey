import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { clarifyPrompt } from "../src/clarify/hook.js";
import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { GUARD_SETS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { withPolicy } from "../src/policy/guards.js";
import { blindBand, HORIZON_EVENT, isoWeek } from "../src/signals/blind-band.js";
import { fmPaths } from "../src/task/paths.js";
import { hook } from "./git-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, ROOT, stdinFrom } from "./support.js";

const found = GUARD_SETS.find((set) => set.id === "ricochete");
if (found === undefined) throw new Error("ricochete guard set missing");
const RICOCHETE = found;

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const line = (at: string, criterion: string, domain: string, source = "skill"): string =>
  JSON.stringify({ at, event: HORIZON_EVENT, source, criterion, domain });

const FIXTURE = [
  line("2026-10-26T10:00:00.000Z", "none", "backend"),
  line("2026-10-27T10:00:00.000Z", "example", "backend", "divergence"),
  line("2026-10-28T10:00:00.000Z", "none", "backend", "clarify"),
  line("2026-10-28T11:00:00.000Z", "check", "backend", "research"),
  line("2026-10-29T09:00:00.000Z", "none", "security"),
  line("2026-11-02T09:00:00.000Z", "scenario", "security"),
  JSON.stringify({ at: "2026-10-28T10:00:00.000Z", event: "gate.run" }),
  "not json",
  "",
].join("\n");

const horizons = (repo: Repo): readonly JsonObject[] =>
  repo
    .read(".finitemonkey/log.jsonl")
    .split("\n")
    .filter((text) => text.includes(HORIZON_EVENT))
    .flatMap((text) => {
      const parsed = parseJsonObject(text);
      return parsed.ok ? [parsed.value] : [];
    });

const stop = (repo: Repo, message: string): ReturnType<typeof runHook> => {
  const runtime = repoRuntime();
  return runHook("Stop", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: "s1",
        cwd: repo.root,
        stop_hook_active: false,
        last_assistant_message: message,
      }),
    ),
    deadlineMs: 60_000,
    handlers: withPolicy(RICOCHETE),
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const project = async (): Promise<Repo> => {
  const repo = makeRepo({ "src/refund.ts": "export const refund = () => 0;\n" });
  repos.push(repo);
  await cliJson(["task", "new", "t1", "--goal", "refunds", "--run", "node --test"], {
    cwd: repo.root,
    runtime: repoRuntime(),
  });
  return repo;
};

describe("blind band index", () => {
  it("counts ISO weeks across the year boundary", () => {
    assert.equal(isoWeek("2026-10-29T12:00:00Z"), "2026-W44");
    assert.equal(isoWeek("2027-01-01T12:00:00Z"), "2026-W53");
    assert.equal(isoWeek("nope"), undefined);
  });

  it("reproduces the expected index from a fixture ledger", () => {
    const repo = makeRepo();
    repos.push(repo);
    const report = blindBand(repoRuntime(), fmPaths(repo.root), FIXTURE);
    assert.deepEqual(
      report.rows.map((row) => [row.week, row.domain, row.helps, row.withoutCriterion, row.index]),
      [
        ["2026-W44", "backend", 4, 2, 0.5],
        ["2026-W44", "security", 1, 1, 1],
        ["2026-W45", "security", 1, 0, 0],
      ],
    );
    assert.deepEqual(report.total, { helps: 6, withoutCriterion: 3, index: 0.5 });
  });

  it("answers signals blind-band --json with the frozen schema", async () => {
    const repo = makeRepo();
    repos.push(repo);
    repo.write(".finitemonkey/log.jsonl", FIXTURE);
    repo.write(
      ".finitemonkey/conceitos.yml",
      "concepts:\n  webhook:\n    level: seen\n    updated_at: 2026-10-27T10:00:00.000Z\n",
    );
    const run = await cliJson(["signals", "blind-band"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 0, run.stdout);
    assert.equal(field(run.body, "data", "schema"), "finitemonkey/blind-band@1");
    const rows = field(run.body, "data", "rows");
    assert.ok(Array.isArray(rows));
    assert.equal(field(rows[0], "conceptsMoved"), 1);
    const schema = parseJsonObject(readFileSync(join(ROOT, "docs/schema/blind-band@1.json"), "utf8"));
    assert.ok(schema.ok);
    const properties = field(schema.value, "properties");
    assert.ok(isRecord(properties));
    assert.deepEqual(Object.keys(properties).sort(), ["rows", "schema", "total"]);
  });

  it("logs horizon help from the skill with the criterion it named", async () => {
    const repo = await project();
    await stop(repo, "Questions an expert would ask:\n1. Is the webhook idempotent?\nJudgment criterion: C1");
    await stop(repo, "Rewritten request: add retries to the webhook");
    assert.deepEqual(
      horizons(repo).map((entry) => [entry["source"], entry["criterion"], entry["domain"]]),
      [
        ["skill", "check", "backend"],
        ["skill", "none", "backend"],
      ],
    );
  });

  it("logs horizon help from clarify and research", async () => {
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    repo.write(".finitemonkey/policy.yml", "guards:\n  clarify: active\n");
    await hook(clarifyPrompt, "UserPromptSubmit", repo.root, {
      prompt: "build a marketplace app with payments, webhooks and admin from scratch",
    });
    await cliJson(["research", "new", "webhook retries"], { cwd: repo.root, runtime: repoRuntime() });
    assert.deepEqual(
      horizons(repo).map((entry) => [entry["source"], entry["criterion"]]),
      [
        ["clarify", "none"],
        ["research", "none"],
      ],
    );
  });
});
