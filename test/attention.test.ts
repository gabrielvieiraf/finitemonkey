import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { inQuietHours, quietRange } from "../src/attention/notify.js";
import { orderAsks } from "../src/attention/queue.js";
import { quantile } from "../src/attention/timebox.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli, execResult } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const watched = (now?: () => string): { runtime: Runtime; sent: ExecRequest[] } => {
  const sent: ExecRequest[] = [];
  const base = repoRuntime(now === undefined ? {} : { now });
  return {
    sent,
    runtime: {
      ...base,
      exec: (request) => {
        if (request.command === "notify-send" || request.command === "osascript") {
          sent.push(request);
          return execResult(0);
        }
        return base.exec(request);
      },
    },
  };
};

const gateStatus = (at: string): string =>
  JSON.stringify({ schemaVersion: 1, status: "passed", task: "t1", detail: "", at });

const setup = (mode: string, extra: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({ ".finitemonkey/policy.yml": policyWith({ attention: mode }), ...extra });
  repos.push(repo);
  return repo;
};

const logOf = (repo: Repo): string => {
  try {
    return repo.read(".finitemonkey/log.jsonl");
  } catch {
    return "";
  }
};

const notifications = (repo: Repo): number =>
  logOf(repo)
    .split("\n")
    .filter((line) => line.includes('"event":"attention.notify"')).length;

describe("attention notifications", () => {
  it("emits exactly one notification per gate verdict and none without a transition", async () => {
    const repo = setup("active", { ".finitemonkey/cache/gate-status.json": gateStatus("2026-10-01T10:00:00.000Z") });
    const { runtime } = watched();
    await fireHook(repo, "Stop", { stop_hook_active: false }, runtime);
    await fireHook(repo, "PostToolUse", { tool_name: "Read", tool_input: { file_path: "a" } }, runtime);
    await fireHook(repo, "Stop", { stop_hook_active: false }, runtime);
    assert.equal(notifications(repo), 1);
  });

  it("notifies when a question waits on the person, and records the wait", async () => {
    const repo = setup("active");
    const { runtime } = watched();
    await fireHook(repo, "Notification", { message: "Claude needs your permission to use Bash" }, runtime);
    await fireHook(repo, "UserPromptSubmit", { prompt: "yes" }, runtime);
    const log = repo.read(".finitemonkey/log.jsonl");
    assert.match(log, /"event":"attention.notify","kind":"ask"/);
    assert.match(log, /"event":"attention.answered","waitMs":\d+/);
  });

  it("emits nothing with the flag off", async () => {
    const repo = setup("off", { ".finitemonkey/cache/gate-status.json": gateStatus("2026-10-01T10:00:00.000Z") });
    const { runtime, sent } = watched();
    await fireHook(repo, "Stop", { stop_hook_active: false }, runtime);
    await fireHook(repo, "Notification", { message: "waiting" }, runtime);
    assert.equal(sent.length, 0);
    assert.doesNotMatch(logOf(repo), /attention/);
  });

  it("keeps quiet hours, including ranges across midnight", () => {
    assert.equal(inQuietHours(23, quietRange("22-7")), true);
    assert.equal(inQuietHours(6, quietRange("22-7")), true);
    assert.equal(inQuietHours(12, quietRange("22-7")), false);
    assert.equal(inQuietHours(12, quietRange("nonsense")), false);
  });
});

const contract = (id: string): string =>
  `id: ${id}\ngoal: ${id}\nsize: M\nscope:\n  paths: [src/billing/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const ledgerOf = (task: string, start: number, hours: number): string => {
  const runtime = repoRuntime();
  const line = (check: string, status: string, at: number): string =>
    signedLine(runtime, {
      schema: "finitemonkey/evidence@1",
      task,
      check,
      kind: check === "*gate*" ? "gate" : "command",
      status,
      treeHash: "t",
      at: new Date(at).toISOString(),
      notes: [],
    });
  return `${[line("t", "failed", start), line("*gate*", "passed", start + hours * 3_600_000)].join("\n")}\n`;
};

describe("timebox", () => {
  it("asks once past the learned horizon, and not again for the task", async () => {
    const day = Date.UTC(2026, 9, 1, 9);
    const past = Object.fromEntries(
      [1, 2, 3, 4, 5].flatMap((n) => [
        [`.finitemonkey/tasks/p${String(n)}.yml`, contract(`p${String(n)}`)],
        [`.finitemonkey/evidence/p${String(n)}.jsonl`, ledgerOf(`p${String(n)}`, day, n)],
      ]),
    );
    const repo = setup("active", {
      ...past,
      ".finitemonkey/tasks/now.yml": contract("now"),
      ".finitemonkey/evidence/now.jsonl": ledgerOf("now", day + 86_400_000, 0),
      ".finitemonkey/state.json": JSON.stringify({
        schemaVersion: 1,
        active: "now",
        done: ["p1", "p2", "p3", "p4", "p5"],
      }),
    });
    const { runtime } = watched(() => new Date(day + 86_400_000 + 6 * 3_600_000).toISOString());
    const first = await fireHook(repo, "UserPromptSubmit", { prompt: "go on" }, runtime);
    const second = await fireHook(repo, "UserPromptSubmit", { prompt: "continue" }, runtime);
    assert.match(first.stdout, /past the 4\.0 h your similar tasks usually take/);
    assert.doesNotMatch(second.stdout, /usually take/);
  });

  it("uses the 80th percentile of past durations", () => {
    assert.equal(quantile([1, 2, 3, 4, 5], 0.8), 4);
  });
});

describe("attention queue", () => {
  it("puts pending asks from three fronts in one ordered queue with wait times", async () => {
    const fronts = [
      "wave: 1",
      "base: main",
      "fronts:",
      "  - id: alpha",
      "    goal: a",
      "    status: running",
      "    inbox:",
      "      - at: 2026-10-01T10:00:00.000Z",
      "        text: which color?",
      "        kind: question",
      "  - id: beta",
      "    goal: b",
      "    status: blocked",
      "    inbox:",
      "      - at: 2026-10-01T11:00:00.000Z",
      "        text: needs the API key name",
      "  - id: gamma",
      "    goal: c",
      "    status: running",
      "    inbox:",
      "      - at: 2026-10-01T09:00:00.000Z",
      "        text: report ready",
      "",
    ].join("\n");
    const repo = setup("active", { ".finitemonkey/fronts.yml": fronts });
    const runtime = repoRuntime({ now: () => "2026-10-01T12:00:00.000Z" });
    const run = await cli(["attention", "--json"], { cwd: repo.root, runtime });
    const body = (JSON.parse(run.stdout) as { data: { asks: readonly { front: string; waitMinutes: number }[] } }).data;
    assert.deepEqual(
      body.asks.map((ask) => [ask.front, ask.waitMinutes]),
      [
        ["beta", 60],
        ["alpha", 120],
        ["gamma", 180],
      ],
    );
  });

  it("orders by priority, then by the oldest ask", () => {
    const ask = (front: string, priority: number, at: string) => ({
      front,
      text: "",
      kind: "note",
      at,
      waitMinutes: 0,
      priority,
    });
    assert.deepEqual(
      orderAsks([ask("a", 2, "2"), ask("b", 1, "3"), ask("c", 1, "1")]).map((item) => item.front),
      ["c", "b", "a"],
    );
  });
});
