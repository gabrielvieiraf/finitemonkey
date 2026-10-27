import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { ExitCode } from "../src/exit-codes.js";
import { projectLogKey } from "../src/history/look-back.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { ingest } from "../src/spend/ingest.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, execResult, field, found, stdinFrom } from "./support.js";

const NOW = "2026-10-27T12:00:00.000Z";
const homes: string[] = [];
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

interface Setup {
  readonly repo: Repo;
  readonly env: Readonly<Record<string, string>>;
  readonly log: (file: string, lines: readonly object[]) => void;
}

const setup = (config: string): Setup => {
  const repo = makeRepo({ ".finitemonkey/config.yml": config, "README.md": "# app\n" });
  repos.push(repo);
  const home = `${repo.root}-claude`;
  homes.push(home);
  const top = repo.git("rev-parse", "--show-toplevel").trim();
  const dir = join(home, "projects", projectLogKey(toAbsolutePath(top)));
  const log = (file: string, lines: readonly object[]): void => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), { flag: "a" });
  };
  return { repo, env: { CLAUDE_CONFIG_DIR: home }, log };
};

const assistant = (id: string, output: number, at = "2026-10-27T11:00:00.000Z") => ({
  type: "assistant",
  timestamp: at,
  message: {
    id,
    model: "claude-opus-5",
    usage: { input_tokens: 1000, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  },
});

const runtime = (): Runtime => repoRuntime({ now: () => NOW });

const total = (repo: Repo, env: Readonly<Record<string, string>>): number => {
  const ledger = ingest({ runtime: runtime(), paths: fmPaths(repo.root), env });
  return Object.values(ledger.messages).reduce((sum, message) => sum + message.usd, 0);
};

describe("agent spend from the session transcripts", () => {
  it("a restart does not double count: cursors per file, dedup by message id, subagents included", () => {
    const { repo, env, log } = setup("budget:\n  day_usd: 100\n");
    log("s1.jsonl", [assistant("m1", 1000), assistant("m1", 2000), assistant("m2", 1000)]);
    log("s1/subagents/agent-a.jsonl", [assistant("m3", 1000)]);
    const first = total(repo, env);
    const expected = (1000 * 5 + 2000 * 25 + 2 * (1000 * 5 + 1000 * 25)) / 1_000_000;
    assert.ok(Math.abs(first - expected) < 1e-9, String(first));
    assert.ok(Math.abs(total(repo, env) - first) < 1e-12);
    log("s1.jsonl", [assistant("m2", 1000)]);
    assert.ok(Math.abs(total(repo, env) - first) < 1e-12);
    const spend = repo.read(".finitemonkey/spend.json");
    repo.write(".finitemonkey/spend.json", spend.replace(/"cursors": \{[^}]*\}/, '"cursors": {}'));
    assert.ok(Math.abs(total(repo, env) - first) < 1e-12);
  });

  it("crossing 100% blocks a new task, and the person can release it", async () => {
    const { repo, env, log } = setup("budget:\n  day_usd: 0.05\n");
    log("s1.jsonl", [assistant("m1", 3000)]);
    const blocked = await cliJson(["task", "new", "t2", "--goal", "next"], { cwd: repo.root, runtime: runtime(), env });
    assert.equal(blocked.code, ExitCode.NeedsPerson);
    assert.match(String(field(blocked.body, "error", "message")), /day \$0\.08 of \$0\.05/);
    const hook = (prompt: string) =>
      runHook("UserPromptSubmit", {
        stdin: stdinFrom(
          JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: repo.root, prompt }),
        ),
        deadlineMs: 5000,
        handlers: DEFAULT_HANDLERS,
        cwd: toAbsolutePath(repo.root),
        t: createTranslator("en"),
        startTimer: runtime().startTimer,
        runtime: runtime(),
        env,
      });
    assert.match((await hook("keep going")).stdout, /Do not start a new task/);
    await hook("fm: allow budget the release needs this fix today");
    const allowed = await cliJson(["task", "new", "t2", "--goal", "next"], { cwd: repo.root, runtime: runtime(), env });
    assert.equal(allowed.code, 0, JSON.stringify(allowed.body));
  });

  it("warns at 80% with numbers labeled as an estimate", async () => {
    const { repo, env, log } = setup("budget:\n  day_usd: 0.09\n");
    log("s1.jsonl", [assistant("m1", 3000)]);
    const run = await cliJson(["budget"], { cwd: repo.root, runtime: runtime(), env });
    assert.equal(field(run.body, "data", "level"), "warn");
    assert.equal(field(run.body, "data", "estimate"), true);
  });

  it("reconcile records the divergence instead of overwriting", async () => {
    const { repo, env, log } = setup("budget:\n  day_usd: 10\n");
    log("s1.jsonl", [assistant("m1", 3000)]);
    const base = runtime();
    const withTool: Runtime = {
      ...base,
      probe: (command, args, timeoutMs) =>
        command === "ccusage" ? found("15.0.0") : base.probe(command, args, timeoutMs),
      exec: (request) =>
        request.command === "ccusage"
          ? execResult(0, JSON.stringify({ daily: [{ date: "2026-10-27", totalCost: 0.1 }] }))
          : base.exec(request),
    };
    const before = total(repo, env);
    const run = await cliJson(["cost", "reconcile"], { cwd: repo.root, runtime: withTool, env });
    assert.equal(run.code, 0, JSON.stringify(run.body));
    await cliJson(["cost", "reconcile"], { cwd: repo.root, runtime: withTool, env });
    const records = repo.read(".finitemonkey/spend-reconcile.jsonl").trim().split("\n");
    assert.equal(records.length, 2);
    assert.match(records[0] ?? "", /"date":"2026-10-27","ours":0\.08,"theirs":0\.1,"diff":-0\.02/);
    assert.ok(Math.abs(total(repo, env) - before) < 1e-12);
  });
});
