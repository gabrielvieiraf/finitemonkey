import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { parseJsonObject } from "../src/core/parsed.js";
import { ROOT } from "./support.js";

const PLUGIN = pathToFileURL(join(ROOT, "scripts", "release-evidence.mjs")).href;

const FIXTURE_EVIDENCE = {
  schema: "finitemonkey/evidence@1",
  version: "2.0.0-next.2",
  budget: { fprWarn: 0.05, fprFail: 0.15, minPositives: 50, minNegatives: 50 },
  guards: [
    {
      guard: "secrets",
      n: 100,
      positives: 50,
      negatives: 50,
      falsePositives: 1,
      falseNegatives: 0,
      fpr: 0.02,
      fnr: 0,
      p50Ms: 0.1,
      p95Ms: 0.2,
      byOrigin: { synthetic: 100, session: 0 },
      wrong: [],
    },
  ],
  contextBytes: {},
  arms: [],
  review: null,
  guardian: {
    guard: "guardian",
    source: "bench/guardian/results.json",
    scenarios: 15,
    positives: 11,
    negatives: 4,
    falsePositives: 0,
    falseNegatives: 0,
    levelMatches: 15,
    fpr: 0,
    fnr: 0,
    personas: [
      {
        persona: "beginner",
        alertPrecision: 1,
        unnecessaryAlerts: 0,
        missed: 0,
        harmfulRedirects: 0,
        acceptanceRate: 1,
      },
    ],
  },
};

describe("release evidence plugin", () => {
  it("labels bench/evidence.json with the version being released", () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-release-")));
    try {
      mkdirSync(join(dir, "bench"));
      writeFileSync(
        join(dir, "bench", "evidence.json"),
        `${JSON.stringify({ schema: "s", version: "1.0.0-next.1" })}\n`,
      );
      const script = [
        `const { prepare } = await import(${JSON.stringify(PLUGIN)});`,
        `prepare({ scripts: [] }, { cwd: ${JSON.stringify(dir)}, nextRelease: { version: "1.0.0-next.2" }, logger: console });`,
      ].join("\n");
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const written = parseJsonObject(readFileSync(join(dir, "bench", "evidence.json"), "utf8"));
      assert.ok(written.ok);
      assert.deepEqual(written.value, { schema: "s", version: "1.0.0-next.2" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the evidence table into the release notes of a fixture repository when notes are on", () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-release-notes-")));
    try {
      mkdirSync(join(dir, "bench"));
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({ repository: { url: "git+https://example.invalid/o/r.git" } })}\n`,
      );
      writeFileSync(join(dir, "bench", "evidence.json"), `${JSON.stringify(FIXTURE_EVIDENCE)}\n`);
      const notes = (config: string): string => {
        const script = [
          `const { generateNotes } = await import(${JSON.stringify(PLUGIN)});`,
          `process.stdout.write(generateNotes(${config}, { cwd: ${JSON.stringify(dir)}, nextRelease: { version: "2.0.0-next.3" } }));`,
        ].join("\n");
        const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
        assert.equal(run.status, 0, run.stderr);
        return run.stdout;
      };
      assert.equal(notes("{}"), "");
      const written = notes("{ notes: true }");
      assert.match(written, /^### Evidence\n/);
      assert.match(written, /on version 2\.0\.0-next\.3/);
      assert.match(written, /\| `secrets` \| 50 \| 50 \| 1\/50 \(2\.0%\) \|/);
      assert.match(written, /\| 15 \| 11 \| 4 \| 0\/4 \(0\.0%\) \| 0\/11 \(0\.0%\) \| 15\/15 \|/);
      assert.match(written, /\(https:\/\/example\.invalid\/o\/r\/tree\/v2\.0\.0-next\.3\/bench\/corpus\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs after the npm plugin and before the git plugin commits the files", () => {
    const config = parseJsonObject(readFileSync(join(ROOT, ".releaserc.json"), "utf8"));
    assert.ok(config.ok);
    const plugins: unknown = config.value["plugins"];
    const names = (Array.isArray(plugins) ? plugins : []).map((plugin: unknown) => {
      const name: unknown = Array.isArray(plugin) ? plugin[0] : plugin;
      return name;
    });
    const at = (name: string): number => names.indexOf(name);
    assert.ok(at("@semantic-release/npm") >= 0);
    assert.ok(at("@semantic-release/npm") < at("./scripts/release-evidence.mjs"));
    assert.ok(at("./scripts/release-evidence.mjs") < at("@semantic-release/git"));
  });
});
