import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { detectProject } from "../src/apicontract/framework.js";
import type { TextSource } from "../src/core/context.js";
import type { GitResult } from "../src/core/runtime.js";
import { detectConventions } from "../src/defaults/detect-conventions.js";
import { lintPlan } from "../src/generate/lint/plan.js";
import { detectStack } from "../src/generate/stack.js";
import { createTranslator } from "../src/i18n/translate.js";
import { CONFIG_FILE } from "../src/install/layout.js";
import { at, repo, ROOT } from "./install-support.js";
import type { MemoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field, found } from "./support.js";

const VITEST = `${JSON.stringify({ name: "app", scripts: { test: "vitest run" }, devDependencies: { vitest: "3" } })}\n`;
const ADAPT = "guards:\n  defaults-adapt: active\n";
const noLog = (): GitResult => ({ found: false, ok: false, stdout: "" });
const tty = (answers: string): TextSource => Object.assign(Readable.from([answers]), { isTTY: true });

const init = (fs: MemoryFs, stdin: TextSource, extra: readonly string[] = []) =>
  cliJson(["init", "--yes", ...extra], {
    cwd: ROOT,
    runtime: fakeRuntime({ fs, git: noLog, tools: { claude: found("2.1.300 (Claude Code)") } }),
    env: {},
    stdin,
  });

const config = (fs: MemoryFs): string => fs.read(at(CONFIG_FILE)) ?? "";

const runnerAfter = (fs: MemoryFs): string =>
  detectProject(
    (relative) => fs.read(at(relative)),
    (relative) => fs.read(at(relative)) !== undefined,
  ).runner;

describe("defaults adapt to the test runner, lint and layout", () => {
  it("detects the runner, the linter and the source folder with their evidence", () => {
    const files: Readonly<Record<string, string>> = { "package.json": VITEST, "biome.json": "{}" };
    const found = detectConventions({
      read: (relative) => files[relative],
      exists: (relative) => files[relative] !== undefined,
      isDir: (relative) => relative === "app",
    });
    assert.deepEqual(found, [
      { id: "tests", value: "vitest", evidence: "package.json (vitest)" },
      { id: "lint", value: "biome", evidence: "biome.json" },
      { id: "layout", value: "app", evidence: "app/" },
    ]);
  });

  it("a repository with a test runner gets one question, and the default follows the answer", async () => {
    const yes = repo({ "package.json": VITEST, ".fm/policy.yml": ADAPT });
    const first = await init(yes, tty("y\n"));
    assert.equal(first.code, 0, first.stdout);
    assert.equal(first.stderr.match(/\[Y\/n\]/g)?.length, 1);
    assert.match(first.stderr, /Tests here run with vitest/);
    assert.match(config(yes), /conventions:\n {2}tests: vitest/);
    assert.equal(runnerAfter(yes), "vitest");
    const again = await init(yes, tty("n\n"));
    assert.doesNotMatch(again.stderr, /Tests here run with/);
    assert.match(config(yes), /tests: vitest/);

    const no = repo({ "package.json": VITEST, ".fm/policy.yml": ADAPT });
    assert.equal((await init(no, tty("n\n"))).code, 0);
    assert.match(config(no), /tests: off/);
    assert.equal(runnerAfter(no), "node");
  });

  it("without a person it asks through the report and changes nothing", async () => {
    const fs = repo({ "package.json": VITEST, ".fm/policy.yml": ADAPT });
    const result = await init(fs, Readable.from([]));
    assert.match(result.stderr + result.stdout, /--tests vitest/);
    const questions = field(result.body, "data", "conventionQuestions");
    assert.deepEqual(questions, [
      {
        id: "tests",
        status: "pending",
        detected: "vitest",
        evidence: "package.json (vitest)",
        options: ["--tests vitest", "--tests off"],
      },
    ]);
    assert.doesNotMatch(config(fs), /tests:/);
  });

  it("stays in shadow by default: nothing is asked or written, the detection only shows in JSON", async () => {
    const fs = repo({ "package.json": VITEST });
    const result = await init(fs, tty("y\n"));
    assert.doesNotMatch(result.stderr, /Tests here run with/);
    assert.doesNotMatch(config(fs), /tests:/);
    const questions = field(result.body, "data", "conventionQuestions");
    assert.ok(Array.isArray(questions));
    assert.equal(field(questions[0], "status"), "shadow");
    assert.equal(runnerAfter(fs), "vitest");
  });

  it("takes the answer as a flag and refuses a malformed one", async () => {
    const fs = repo({ "package.json": VITEST });
    assert.equal((await init(fs, Readable.from([]), ["--tests", "jest", "--layout", "lib"])).code, 0);
    assert.match(config(fs), /conventions:\n {2}tests: jest\n {2}layout: lib/);
    assert.equal(runnerAfter(fs), "jest");
    const bad = await init(repo(), Readable.from([]), ["--tests", "Not A Runner"]);
    assert.notEqual(bad.code, 0);
    assert.equal(field(bad.body, "error", "code"), "invalid_arguments");
  });

  it("lint setup follows the lint convention", () => {
    const fs = repo({ "package.json": VITEST, [CONFIG_FILE]: "conventions:\n  lint: biome\n" });
    const stack = detectStack(fakeRuntime({ fs }), ROOT);
    const plan = lintPlan(createTranslator("en"), stack, new Set(), (path) => fs.read(at(path)));
    assert.deepEqual(plan.files, []);
    assert.deepEqual(plan.notes, [
      "biome is the linter here (conventions.lint in .fm/config.yml), so no ESLint config was generated.",
    ]);
  });
});
