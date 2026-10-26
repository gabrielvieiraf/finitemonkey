import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { ExitCode } from "../src/exit-codes.js";
import { lookBack, projectLogDir, projectLogKey } from "../src/history/look-back.js";
import { hitsIn, type Pattern, PATTERNS } from "../src/history/patterns.js";
import { parseTranscript } from "../src/history/transcript.js";
import { repo, ROOT } from "./install-support.js";
import { memoryFs } from "./memory-fs.js";
import { BUNDLE, BUNDLE_TEXT, cliJson, fakeRuntime, field, found, ROOT as REPO_ROOT } from "./support.js";

const fixture = (name: string): string => readFileSync(join(REPO_ROOT, "test", "fixtures", "history", name), "utf8");

const isPatternList = (value: unknown): value is readonly Pattern[] =>
  Array.isArray(value) && value.every((item) => PATTERNS.some((pattern) => pattern === item));

describe("look back at past sessions", () => {
  it("finds the project folder the way Claude Code names it", () => {
    assert.equal(projectLogKey("/mnt/c/Users/ana/my_app.v2"), "-mnt-c-Users-ana-my-app-v2");
    assert.equal(projectLogKey("C:\\Users\\ana\\app"), "C--Users-ana-app");
  });

  it("keeps false positives under 10% on 50 labeled turns", () => {
    const turns = parseTranscript(fixture("labeled.jsonl"));
    const parsed: unknown = JSON.parse(fixture("labels.json"));
    assert.ok(Array.isArray(parsed));
    const labels = parsed.map((item: unknown) => {
      assert.ok(isPatternList(item));
      return item;
    });
    assert.equal(turns.length, 50);
    assert.equal(labels.length, 50);
    let truePositives = 0;
    let falsePositives = 0;
    let expected = 0;
    turns.forEach((turn, index) => {
      const wanted = [...(labels[index] ?? [])];
      expected += wanted.length;
      for (const hit of hitsIn(turn)) {
        const at = wanted.indexOf(hit.pattern);
        if (at >= 0) {
          truePositives += 1;
          wanted.splice(at, 1);
        } else falsePositives += 1;
      }
    });
    const predicted = truePositives + falsePositives;
    assert.ok(falsePositives / predicted < 0.1, `${String(falsePositives)} false positives of ${String(predicted)}`);
    assert.ok(truePositives / expected >= 0.9, `recall ${String(truePositives)}/${String(expected)}`);
  });

  it("masks secrets in the samples it shows", () => {
    const token = `ghp_${"a1B2c3D4e5".repeat(3)}abcdef`;
    const transcript = [
      { type: "user", message: { content: "load env" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "Bash", input: { command: `source .env && GH=${token} gh api user` } },
          ],
        },
      },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");
    const runtime = fakeRuntime({
      files: {
        [toAbsolutePath(join(projectLogDir({ homeDir: () => "/home/test" }, ROOT, {}), "s.jsonl"))]: transcript,
      },
    });
    const result = lookBack(runtime, ROOT, {});
    assert.equal(result.counts.env_read, 1);
    const sample = result.samples.env_read[0] ?? "";
    assert.ok(!sample.includes(token), sample);
    assert.match(sample, /«secret:/);
  });
});

describe("init --look-back", () => {
  const home = "/home/test";
  const logDir = projectLogDir({ homeDir: () => home }, ROOT, {});

  it("reads no transcript without --look-back", async () => {
    const reads: string[] = [];
    const fs = repo({});
    const runtime = fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } });
    const spy = {
      ...runtime,
      readText: (path: Parameters<typeof runtime.readText>[0]) => (reads.push(path), runtime.readText(path)),
    };
    const result = await cliJson(["init", "--yes"], { cwd: ROOT, runtime: spy, env: {} });
    assert.equal(result.code, ExitCode.Ok);
    assert.deepEqual(
      reads.filter((path) => path.replace(/\\/g, "/").includes("/.claude/projects/")),
      [],
    );
    assert.equal(field(result.body, "data", "lookBack"), undefined);
  });

  it("with --look-back, prints counts marked as an estimate and writes nothing about them", async () => {
    const fs = memoryFs(
      { [BUNDLE]: BUNDLE_TEXT, [join(toAbsolutePath(logDir), "a.jsonl")]: fixture("labeled.jsonl") },
      [join(ROOT, ".git")],
    );
    const runtime = fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } });
    const result = await cliJson(["init", "--dry-run", "--look-back"], { cwd: ROOT, runtime, env: {} });
    assert.equal(result.code, ExitCode.Ok);
    assert.equal(field(result.body, "data", "lookBack", "estimate"), true);
    assert.equal(field(result.body, "data", "lookBack", "turns"), 50);
    assert.ok(Number(field(result.body, "data", "lookBack", "counts", "force_push")) >= 5);
    assert.equal(fs.writes(), 0);
  });
});
