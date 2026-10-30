import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { type SessionStats, sessionStats } from "../src/drift/collect.js";
import { driftReport } from "../src/drift/sensor.js";
import { projectLogKey } from "../src/history/look-back.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli } from "./support.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const day = (n: number): string => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);

const session = (n: number, model: string, reads: number, files: number): SessionStats => ({
  day: day(n),
  model,
  version: "2.1.0",
  reads,
  edits: 10,
  writes: 0,
  corrections: 0,
  files,
});

describe("drift sensor", () => {
  it("warns once, naming the model change, when reads per edit drop and stay down", () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, n) => session(n, "model-a", 60, 2)),
      ...Array.from({ length: 4 }, (_, n) => session(10 + n, "model-b", 20, 2)),
    ];
    const report = driftReport(sessions);
    assert.equal(report.warnings.length, 1);
    const [warning] = report.warnings;
    assert.ok(warning);
    assert.equal(warning.indicator, "readsPerEdit");
    assert.equal(warning.since, day(10));
    assert.deepEqual(warning.changes, ["model model-a -> model-b"]);
  });

  it("does not warn when only the task mix changes", () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, n) => [session(n, "model-a", 60, 2), session(n, "model-a", 20, 6)]).flat(),
      ...Array.from({ length: 5 }, (_, n) => [
        session(10 + n, "model-a", 20, 6),
        session(10 + n, "model-a", 20, 7),
        session(10 + n, "model-a", 20, 8),
      ]).flat(),
    ];
    assert.deepEqual(driftReport(sessions).warnings, []);
  });

  it("ignores a short dip that does not persist", () => {
    const sessions = Array.from({ length: 14 }, (_, n) => session(n, "model-a", n === 8 || n === 9 ? 20 : 60, 2));
    assert.deepEqual(driftReport(sessions).warnings, []);
  });

  it("reads tool calls, the model and the version from a session log", () => {
    const lines = [
      { type: "user", timestamp: "2026-09-01T10:00:00Z", version: "2.1.0", message: { content: "No, that's wrong" } },
      {
        type: "assistant",
        timestamp: "2026-09-01T10:00:01Z",
        version: "2.1.0",
        message: {
          model: "model-a",
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
            { type: "tool_use", name: "Edit", input: { file_path: "a.ts" } },
            { type: "tool_use", name: "Write", input: { file_path: "b.ts" } },
          ],
        },
      },
    ];
    const stats = sessionStats(lines.map((line) => JSON.stringify(line)).join("\n"));
    assert.deepEqual(stats, {
      day: "2026-09-01",
      model: "model-a",
      version: "2.1.0",
      reads: 1,
      edits: 1,
      writes: 1,
      corrections: 1,
      files: 2,
    });
  });
});

const logLine = (n: number, model: string, reads: number): string => {
  const at = `${day(n)}T10:00:00Z`;
  const tools = [
    ...Array.from({ length: reads }, () => ({ type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } })),
    ...Array.from({ length: 10 }, () => ({ type: "tool_use", name: "Edit", input: { file_path: "src/a.ts" } })),
  ];
  return JSON.stringify({ type: "assistant", timestamp: at, version: "2.1.0", message: { model, content: tools } });
};

describe("drift command", () => {
  it("replays local logs into one warning, reproducibly, without any process or network call", async () => {
    const repo: Repo = makeRepo({ "README.md": "x\n" });
    const config = mkdtempSync(join(tmpdir(), "fm-claude-"));
    cleanups.push(repo.cleanup, () => {
      rmSync(config, { recursive: true, force: true });
    });
    const top = toAbsolutePath(repo.git("rev-parse", "--show-toplevel").trim());
    const dir = join(config, "projects", projectLogKey(top));
    mkdirSync(dir, { recursive: true });
    for (let n = 0; n < 14; n += 1) {
      writeFileSync(
        join(dir, `s${String(n).padStart(2, "0")}.jsonl`),
        `${logLine(n, n < 10 ? "model-a" : "model-b", n < 10 ? 60 : 20)}\n`,
      );
    }
    const base = repoRuntime();
    let calls = 0;
    const runtime: Runtime = {
      ...base,
      exec: (request) => {
        calls += 1;
        return base.exec(request);
      },
    };
    const env = { CLAUDE_CONFIG_DIR: config };
    const first = await cli(["drift", "--json"], { cwd: repo.root, runtime, env });
    const second = await cli(["drift", "--json"], { cwd: repo.root, runtime, env });
    const body = JSON.parse(first.stdout) as { data: { warnings: readonly { changes: readonly string[] }[] } };
    assert.equal(body.data.warnings.length, 1);
    assert.deepEqual(body.data.warnings[0]?.changes, ["model model-a -> model-b"]);
    assert.equal(first.stdout, second.stdout);
    assert.equal(calls, 0);
  });
});
