import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { qualityCheck } from "../src/gate/checks/quality.js";
import { prepareGate } from "../src/gate/prepare.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { analyzeQuality, type QualitySources } from "../src/quality/analyze.js";
import { DEFAULT_LIMITS, parseLimits } from "../src/quality/limits.js";
import type { QualityFinding } from "../src/quality/ratchet.js";
import { loadTypescript } from "../src/quality/ts-api.js";
import { implicitContract } from "../src/task/implicit.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { ROOT, stdinFrom } from "./support.js";

const ts = loadTypescript(ROOT);
const fixture = (name: string): string => readFileSync(join(ROOT, "test", "fixtures", "quality", name), "utf8");
const lines = (count: number, prefix = "line"): string =>
  Array.from({ length: count }, (_, index) => `const ${prefix}${String(index)} = ${String(index)};`).join("\n") + "\n";

interface Files {
  readonly before?: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
  readonly lookExports?: boolean;
}

const sources = (files: Files): QualitySources => {
  const all = { ...files.before, ...files.after };
  return {
    changed: Object.keys(files.after),
    before: (file) => files.before?.[file],
    after: (file) => all[file],
    exists: (file) => all[file] !== undefined,
    consumed: (name, file) =>
      files.lookExports !== true ||
      Object.entries(all).some(([other, text]) => other !== file && new RegExp(`\\b${name}\\b`).test(text)),
    ts,
  };
};

const rules = (files: Files, limits = DEFAULT_LIMITS): readonly string[] =>
  analyzeQuality(sources(files), limits).findings.map((finding: QualityFinding) => `${finding.level}:${finding.rule}`);

describe("quality limits by delta on touched code", () => {
  it("blocks a new file over 800 lines and warns over 400", () => {
    assert.deepEqual(rules({ after: { "src/big.ts": lines(801) } }), ["block:file_lines"]);
    assert.deepEqual(rules({ after: { "src/mid.ts": lines(401) } }), ["warn:file_lines_warn"]);
  });

  it("lets an existing large file shrink or stay, and blocks it from growing", () => {
    const before = { "src/big.ts": lines(900) };
    assert.deepEqual(rules({ before, after: { "src/big.ts": lines(850) } }), []);
    assert.deepEqual(rules({ before, after: { "src/big.ts": lines(900) } }), []);
    assert.deepEqual(rules({ before, after: { "src/big.ts": lines(901) } }), ["block:file_lines"]);
  });

  it("blocks cognitive complexity over 15 only when new or worse", () => {
    const complex = fixture("complex.ts.txt");
    assert.deepEqual(rules({ after: { "src/route.ts": complex } }), ["block:function_complexity"]);
    const better = complex.replace("return c ? 1 : 2;", "return 1;");
    assert.deepEqual(rules({ before: { "src/route.ts": complex }, after: { "src/route.ts": better } }), []);
    const worse = complex.replace("a += 1;", "a += c ? 1 : 2;");
    assert.deepEqual(rules({ before: { "src/route.ts": complex }, after: { "src/route.ts": worse } }), [
      "block:function_complexity",
    ]);
  });

  it("blocks nesting over 4", () => {
    assert.deepEqual(rules({ after: { "src/deep.ts": fixture("nested.ts.txt") } }), ["block:function_nesting"]);
  });

  it("blocks a new nested ternary and keeps an old one", () => {
    const text = fixture("ternary.ts.txt");
    assert.deepEqual(rules({ after: { "src/label.ts": text } }), ["block:nested_ternary"]);
    assert.deepEqual(rules({ before: { "src/label.ts": text }, after: { "src/label.ts": `${text}\n` } }), []);
  });

  it("blocks a new clone of 10 or more lines across touched files", () => {
    const clone = fixture("clone.ts.txt");
    const renamed = clone.replace("normalize", "slugify");
    assert.deepEqual(rules({ after: { "src/a.ts": clone, "src/b.ts": renamed } }), ["block:clone"]);
    const before = { "src/a.ts": clone, "src/b.ts": renamed };
    assert.deepEqual(rules({ before, after: { "src/a.ts": clone, "src/b.ts": `${renamed}\n` } }), []);
  });

  it("blocks a new import cycle and not an old one", () => {
    const a = 'import { b } from "./b.js";\nexport const a = (): number => b + 1;\n';
    const b = "export const b = 1;\n";
    const cyclic = 'import { a } from "./a.js";\nexport const b = 1;\nexport const c = (): number => a();\n';
    assert.deepEqual(rules({ before: { "src/a.ts": a, "src/b.ts": b }, after: { "src/b.ts": cyclic } }), [
      "block:import_cycle",
    ]);
    assert.deepEqual(rules({ before: { "src/a.ts": a, "src/b.ts": cyclic }, after: { "src/b.ts": cyclic } }), []);
    const typeOnly = 'import type { A } from "./a.js";\nexport const b = 1;\nexport type B = A;\n';
    assert.deepEqual(rules({ before: { "src/a.ts": a, "src/b.ts": b }, after: { "src/b.ts": typeOnly } }), []);
  });

  it("warns on long functions, many parameters, long call chains, busy statements and unused exports", () => {
    const text = fixture("warnings.ts.txt");
    const consumer = 'import { wide, chained } from "./warn.js";\nexport const use = [wide, chained];\n';
    assert.deepEqual(rules({ before: { "src/use.ts": consumer }, after: { "src/warn.ts": text }, lookExports: true }), [
      "warn:function_params",
      "warn:call_chain",
    ]);
    const body = Array.from({ length: 60 }, (_, index) => `  const x${String(index)} = ${String(index)};\n`).join("");
    const long = `export const long = (): number => {\n${body}  return 1;\n};\n`;
    assert.deepEqual(rules({ after: { "src/long.ts": long }, lookExports: true }), [
      "warn:function_lines",
      "warn:unused_export",
    ]);
    const sum = Array.from({ length: 16 }, () => "a + b").join(" + ");
    const busy = `export const busy = (a: number, b: number): number =>\n  ${sum};\n`;
    const user = { "src/user.ts": 'import { busy } from "./busy.js";\nexport const total = busy(1, 2);\n' };
    assert.deepEqual(rules({ before: user, after: { "src/busy.ts": busy }, lookExports: true }), [
      "warn:statement_identifiers",
    ]);
  });

  it("reads every limit from policy.yml", () => {
    const limits = parseLimits(
      "quality:\n  fileLinesBlock: 1000\n  complexityBlock: 20\n  cloneLines: 30\n  ignore:\n    - legacy/**\n",
    );
    assert.equal(limits.fileLinesBlock, 1000);
    assert.equal(limits.complexityBlock, 20);
    assert.equal(limits.cloneLines, 30);
    assert.equal(limits.fileLinesWarn, DEFAULT_LIMITS.fileLinesWarn);
    assert.deepEqual(rules({ after: { "src/big.ts": lines(900) } }, limits), ["warn:file_lines_warn"]);
    assert.deepEqual(rules({ after: { "legacy/big.ts": lines(1200) } }, limits), []);
    assert.deepEqual(rules({ after: { "src/route.ts": fixture("complex.ts.txt") } }, limits), []);
  });
});

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const project = (files: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({
    "package.json": "{}\n",
    "src/big.ts": lines(900),
    ".finitemonkey/policy.yml":
      "guards:\n  quality: active\n  slop: active\n  tests-hold: active\n  regression: active\n  advisor: active\n  reminders: active\n  learnings: active\n  rules-stop: active\n",
    ...files,
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
  return qualityCheck({ id: "quality", kind: "quality" }, ready.prepared.ctx);
};

describe("quality check at Stop", () => {
  it("is part of the implicit contract", () => {
    const kinds = implicitContract({ read: () => undefined, exists: () => false }).acceptance.map((c) => c.kind);
    assert.ok(kinds.includes("quality"));
  });

  it("fails when a large file grows, passes when it shrinks, and follows the policy mode", () => {
    const repo = project();
    repo.write("src/big.ts", lines(905));
    const grown = gate(repo);
    assert.equal(grown.status, "failed");
    assert.equal(grown.notes[0]?.key, "gate.quality.file_lines");
    assert.equal(grown.notes[0].params["file"], "src/big.ts");
    repo.write(".finitemonkey/policy.yml", "guards:\n  quality: shadow\n");
    const shadow = gate(repo);
    assert.equal(shadow.status, "passed");
    assert.equal(shadow.notes[0]?.key, "gate.quality.shadow");
    repo.write(".finitemonkey/policy.yml", "guards:\n  quality: off\n");
    assert.deepEqual(
      gate(repo).notes.map((item) => item.key),
      ["gate.quality.off"],
    );
    repo.remove(".finitemonkey/policy.yml");
    repo.write("src/big.ts", lines(700));
    assert.equal(gate(repo).status, "passed");
  });

  it("finds a new export without consumers through git grep", () => {
    const repo = project({ "src/user.ts": 'import { used } from "./lib.js";\nexport const x = used;\n' });
    repo.write("src/lib.ts", "export const used = 1;\nexport const lonely = 2;\n");
    const outcome = gate(repo);
    assert.equal(outcome.status, "passed");
    assert.deepEqual(
      outcome.notes.filter((item) => item.key === "gate.quality.unused_export").map((item) => item.params["name"]),
      ["lonely"],
    );
  });
});

describe("quality size guard on edit", () => {
  const fire = async (repo: Repo, content: string) => {
    const runtime = repoRuntime();
    return runHook("PreToolUse", {
      stdin: stdinFrom(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "s1",
          cwd: repo.root,
          tool_name: "Write",
          tool_input: { file_path: join(repo.root, "src", "big.ts"), content },
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
  };

  it("denies an edit that grows a file past the limit and lets a shrinking one through", async () => {
    const repo = project();
    const grown = await fire(repo, lines(950));
    assert.equal(grown.verdict, "block");
    assert.match(grown.stdout, /src\/big\.ts would have 950 lines/);
    assert.equal((await fire(repo, lines(850))).verdict, "allow");
  });

  it("only warns in shadow mode", async () => {
    const repo = project({ ".finitemonkey/policy.yml": "guards:\n  quality: shadow\n" });
    const outcome = await fire(repo, lines(950));
    assert.equal(outcome.verdict, "allow");
    assert.match(outcome.stdout, /would have 950 lines/);
  });
});
