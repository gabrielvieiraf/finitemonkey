import assert from "node:assert/strict";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { addedByContent } from "../src/core/line-diff.js";
import { slopCheck } from "../src/gate/checks/slop.js";
import { prepareGate } from "../src/gate/prepare.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { loadTypescript } from "../src/quality/ts-api.js";
import { analyzeSlop } from "../src/slop/analyze.js";
import { DEFAULT_SLOP_CONFIG, parseSlopConfig, type SlopConfig } from "../src/slop/config.js";
import { readSlopStore } from "../src/slop/store.js";
import { SLOP_DETECTORS, type SlopDetector } from "../src/slop/types.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, ROOT, stdinFrom } from "./support.js";

const ts = loadTypescript(ROOT);

interface Case {
  readonly file: string;
  readonly text: string;
  readonly exists?: readonly string[];
}

const detectors = (sample: Case, config: SlopConfig = DEFAULT_SLOP_CONFIG): readonly SlopDetector[] =>
  analyzeSlop({
    files: [{ file: sample.file, text: sample.text, added: addedByContent(undefined, sample.text), created: true }],
    exists: (file) => (sample.exists ?? []).includes(file),
    config,
    ts,
  }).map((item) => item.detector);

const FIXTURES: Readonly<Record<SlopDetector, { readonly block: Case; readonly pass: Case }>> = {
  sibling_file: {
    block: { file: "src/parser_v2.ts", text: "export const parse = 1;\n", exists: ["src/parser.ts"] },
    pass: { file: "src/parser_v2.ts", text: "export const parse = 1;\n" },
  },
  improvement_name: {
    block: { file: "src/a.ts", text: "export const parserEnhanced = (): number => 1;\n" },
    pass: { file: "src/a.ts", text: "export const deepCopy = (): number => 1;\nexport const updatedAt = 2;\n" },
  },
  narrating_comment: {
    block: { file: "src/a.ts", text: "// Updated to use the new client\nexport const x = 1;\n" },
    pass: { file: "src/a.ts", text: "// retries stop at 3 because the provider bans after 4\nexport const x = 1;\n" },
  },
  emoji: {
    block: { file: "src/a.ts", text: "export const x = 1; // \u{1F680}\n" },
    pass: { file: "src/a.ts", text: 'export const done = "✅ saved";\n' },
  },
  swallowed_error: {
    block: { file: "src/a.ts", text: "try {\n  run();\n} catch {\n}\n" },
    pass: { file: "src/a.ts", text: "try {\n  run();\n} catch (error) {\n  throw error;\n}\n" },
  },
  unchecked_any: {
    block: { file: "src/a.ts", text: "export const a: any = 1;\n" },
    pass: { file: "src/a.ts", text: "// reason: the SDK ships no types\nexport const a: any = 1;\n" },
  },
  debug_output: {
    block: { file: "src/a.ts", text: "console.log(total);\n" },
    pass: { file: "src/a.ts", text: "console.error(total);\n" },
  },
  version_name: {
    block: { file: "src/a.ts", text: "export const fetchUserV2 = 1;\n" },
    pass: { file: "src/a.ts", text: "export const fetchUser = 1;\n" },
  },
  generic_name: {
    block: { file: "src/a.ts", text: "export const data = 1;\n" },
    pass: { file: "src/a.ts", text: "export const invoiceData = 1;\n" },
  },
  literal_fallback: {
    block: { file: "src/a.ts", text: 'export const name = user.name ?? "";\n' },
    pass: { file: "src/a.ts", text: "export const name = user.name;\n" },
  },
  reexport_shim: {
    block: { file: "src/shim.ts", text: 'export * from "./real.js";\n' },
    pass: { file: "src/index.ts", text: 'export * from "./real.js";\n' },
  },
  pass_through: {
    block: { file: "src/a.ts", text: "export const getUser = (id: string) => fetchUser(id);\n" },
    pass: { file: "src/a.ts", text: "export const getUser = (id: string) => fetchUser(id, { cache: true });\n" },
  },
  summary_markdown: {
    block: { file: "IMPLEMENTATION_SUMMARY.md", text: "# done\n" },
    pass: { file: "docs/IMPLEMENTATION_SUMMARY.md", text: "# done\n" },
  },
};

describe("slop detectors", () => {
  for (const detector of SLOP_DETECTORS) {
    it(`${detector} has a blocking and a passing fixture`, () => {
      const { block, pass } = FIXTURES[detector];
      assert.ok(detectors(block).includes(detector), `${detector} missed ${block.text}`);
      assert.ok(!detectors(pass).includes(detector), `${detector} fired on ${pass.text}`);
    });
  }

  it("leaves api/v2/ and project allow list paths and names alone", () => {
    const route = {
      file: "src/api/v2/users_v2.ts",
      text: "export const fetchUserV2 = 1;\n",
      exists: ["src/api/v2/users.ts"],
    };
    assert.deepEqual(detectors(route), []);
    const config = parseSlopConfig("slop:\n  allow:\n    - legacy/**\n  names:\n    - fetchUserV2\n");
    assert.deepEqual(detectors({ file: "legacy/x.ts", text: "console.log(1);\n" }, config), []);
    assert.deepEqual(detectors({ file: "src/x.ts", text: "export const fetchUserV2 = 1;\n" }, config), []);
  });

  it("judges only added lines", () => {
    const before = "console.log(old);\nexport const x = 1;\n";
    const after = `${before}export const y = 2;\n`;
    const found = analyzeSlop({
      files: [{ file: "src/a.ts", text: after, added: addedByContent(before, after), created: false }],
      exists: () => true,
      config: DEFAULT_SLOP_CONFIG,
      ts,
    });
    assert.deepEqual(found, []);
  });
});

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const project = (): Repo => {
  const repo = makeRepo({
    "package.json": "{}\n",
    "src/legacy.ts": "console.log(boot);\nexport const legacy = 1;\n",
    "src/user.ts": "export const user = 1;\n",
    "src/old.ts": "export const old = 1;\n",
  });
  repos.push(repo);
  return repo;
};

const gate = (repo: Repo) => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: undefined,
    budgetMs: 5000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  return slopCheck({ id: "slop", kind: "slop" }, ready.prepared.ctx);
};

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

describe("slop check at Stop", () => {
  it("passes a legacy file whose old lines have slop and fails on a new one", () => {
    const repo = project();
    repo.write("src/legacy.ts", "console.log(boot);\nexport const legacy = 1;\nexport const more = 2;\n");
    assert.equal(gate(repo).status, "passed");
    repo.write("src/legacy.ts", "console.log(boot);\nexport const legacy = 1;\nconsole.log(legacy);\n");
    const outcome = gate(repo);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      outcome.notes.slice(0, 1).map((item) => [item.key, item.params["line"]]),
      [["gate.slop.debug_output", 3]],
    );
  });

  it("does not treat a rename as a sibling file", () => {
    const repo = project();
    repo.git("mv", "src/old.ts", "src/user_old.ts");
    assert.equal(gate(repo).status, "passed");
    repo.write("src/user_v2.ts", "export const account = 1;\n");
    assert.equal(gate(repo).notes[0]?.key, "gate.slop.sibling_file");
  });

  it("records hits and dismissals per detector, and a dismissed finding stops blocking", async () => {
    const repo = project();
    repo.write("src/legacy.ts", "console.log(boot);\nexport const legacy = 1;\nconsole.log(legacy);\n");
    assert.equal(gate(repo).status, "failed");
    const runtime = repoRuntime();
    const byModel = await cliJson(["slop", "dismiss", "debug_output", "src/legacy.ts:3", "--reason", "x"], {
      cwd: repo.root,
      runtime,
      env: { CLAUDECODE: "1" },
    });
    assert.equal(byModel.code, 4);
    const dismissed = await cliJson(
      ["slop", "dismiss", "debug_output", "src/legacy.ts:3", "--reason", "startup banner on purpose"],
      { cwd: repo.root, runtime, stdin: tty() },
    );
    assert.equal(dismissed.code, 0, dismissed.stdout);
    assert.equal(gate(repo).status, "passed");
    const stats = await cliJson(["slop", "stats"], { cwd: repo.root, runtime });
    const rows = field(stats.body, "data", "detectors");
    const list: readonly unknown[] = Array.isArray(rows) ? rows : [];
    const debug = list.find((row) => field(row, "detector") === "debug_output");
    assert.equal(field(debug, "hits"), 1);
    assert.equal(field(debug, "dismissed"), 1);
    assert.equal(field(debug, "review"), true);
    assert.equal(readSlopStore(runtime, fmPaths(repo.root)).dismissed[0]?.reason, "startup banner on purpose");
  });

  it("only warns in shadow mode", () => {
    const repo = project();
    repo.write(".finitemonkey/policy.yml", "guards:\n  slop: shadow\n");
    repo.write("src/legacy.ts", "console.log(boot);\nexport const legacy = 1;\nconsole.log(legacy);\n");
    const outcome = gate(repo);
    assert.equal(outcome.status, "passed");
    assert.equal(outcome.notes[0]?.key, "gate.slop.shadow");
  });
});

describe("slop warning on edit", () => {
  it("adds context and never blocks", async () => {
    const repo = project();
    const runtime = repoRuntime();
    const outcome = await runHook("PreToolUse", {
      stdin: stdinFrom(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "s1",
          cwd: repo.root,
          tool_name: "Write",
          tool_input: { file_path: join(repo.root, "src", "user_v2.ts"), content: "export const account = 1;\n" },
        }),
      ),
      deadlineMs: 5000,
      handlers: DEFAULT_HANDLERS,
      cwd: repo.root,
      t: createTranslator("en"),
      startTimer: runtime.startTimer,
      runtime,
      env: {},
    });
    assert.equal(outcome.verdict, "allow");
    assert.match(outcome.stdout, /new file next to src\/user\.ts/);
  });
});
