import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest } from "../src/core/runtime.js";
import { qualityCheck } from "../src/gate/checks/quality.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { DetectorSources, PythonRunner } from "../src/quality/detector-sources.js";
import { analyzeDetectors } from "../src/quality/detectors.js";
import { DEFAULT_LIMITS } from "../src/quality/limits.js";
import type { FunctionMetric } from "../src/quality/metrics.js";
import { parsePythonMetrics } from "../src/quality/python-metrics.js";
import { packageSpecifier } from "../src/quality/specifiers.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { execResult } from "./support.js";

interface Files {
  readonly before?: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
  readonly untouched?: Readonly<Record<string, string>>;
  readonly python?: PythonRunner;
}

const NO_PYTHON: PythonRunner = () => undefined;

const sources = (files: Files): DetectorSources => {
  const now = { ...files.untouched, ...files.after };
  const base = { ...files.untouched, ...files.before };
  return {
    changed: Object.keys(files.after),
    before: (file) => base[file],
    after: (file) => now[file],
    referenced: (name, exclude) =>
      Object.entries(now).some(
        ([file, text]) => !exclude.includes(file) && !file.includes("node_modules/") && text.includes(name),
      ),
    python: files.python ?? NO_PYTHON,
  };
};

const rules = (files: Files): readonly string[] =>
  analyzeDetectors(sources(files), DEFAULT_LIMITS).findings.map((finding) => `${finding.level}:${finding.rule}`);

const LIB = {
  "node_modules/lib/package.json": JSON.stringify({
    name: "lib",
    exports: { ".": "./index.js", "./extra": "./extra.js" },
  }),
  "node_modules/old/package.json": JSON.stringify({ name: "old", main: "index.js" }),
};

describe("deep imports", () => {
  it("blocks a new import past the declared entry points and passes the public ones", () => {
    assert.deepEqual(rules({ untouched: LIB, after: { "src/a.ts": 'import { x } from "lib/internal/x.js";\n' } }), [
      "block:deep_import",
    ]);
    assert.deepEqual(
      rules({ untouched: LIB, after: { "src/a.ts": 'import { x } from "lib/extra";\nimport "lib";\n' } }),
      [],
    );
  });

  it("uses internal folder names when the package declares no exports, and keeps old imports", () => {
    assert.deepEqual(rules({ untouched: LIB, after: { "src/a.ts": 'const x = require("old/lib/x");\n' } }), [
      "block:deep_import",
    ]);
    assert.deepEqual(rules({ untouched: LIB, after: { "src/a.ts": 'import x from "old/fp";\n' } }), []);
    const text = 'import { x } from "lib/internal/x.js";\n';
    assert.deepEqual(rules({ untouched: LIB, before: { "src/a.ts": text }, after: { "src/a.ts": `${text}\n` } }), []);
  });

  it("skips aliases, relative paths and packages it cannot find", () => {
    assert.equal(packageSpecifier("@/components/x"), undefined);
    assert.equal(packageSpecifier("./x"), undefined);
    assert.equal(packageSpecifier("node:fs"), undefined);
    assert.deepEqual(packageSpecifier("@scope/pkg/deep/x"), {
      specifier: "@scope/pkg/deep/x",
      name: "@scope/pkg",
      subpath: "deep/x",
    });
    assert.deepEqual(rules({ after: { "src/a.ts": 'import x from "missing/src/x";\n' } }), []);
  });
});

const manifest = (deps: Readonly<Record<string, string>>, scripts: Readonly<Record<string, string>> = {}): string =>
  `${JSON.stringify({ name: "app", scripts, devDependencies: deps }, null, 2)}\n`;

describe("unused dependencies", () => {
  it("blocks a new dependency that nothing imports and passes one that is imported", () => {
    const before = { "package.json": manifest({}) };
    assert.deepEqual(rules({ before, after: { "package.json": manifest({ leftpad: "1.0.0" }) } }), [
      "block:unused_dependency",
    ]);
    assert.deepEqual(
      rules({
        before,
        after: { "package.json": manifest({ leftpad: "1.0.0" }) },
        untouched: { "src/a.ts": 'import pad from "leftpad";\n' },
      }),
      [],
    );
  });

  it("counts tooling run by scripts or named in configs, and ignores old and types-only entries", () => {
    const before = { "package.json": manifest({}) };
    const bin = { "node_modules/typescript/package.json": JSON.stringify({ bin: { tsc: "bin/tsc" } }) };
    assert.deepEqual(
      rules({
        before,
        untouched: bin,
        after: { "package.json": manifest({ typescript: "5" }, { build: "tsc -p ." }) },
      }),
      [],
    );
    assert.deepEqual(
      rules({
        before,
        untouched: { "eslint.config.mjs": 'import x from "eslint-plugin-foo";\n' },
        after: { "package.json": manifest({ "eslint-plugin-foo": "1" }) },
      }),
      [],
    );
    assert.deepEqual(rules({ before, after: { "package.json": manifest({ "@types/node": "1" }) } }), []);
    const old = { "package.json": manifest({ leftpad: "1" }) };
    assert.deepEqual(rules({ before: old, after: { "package.json": manifest({ leftpad: "2" }) } }), []);
  });
});

describe("duplicated config", () => {
  it("blocks the same key with different values across one tool's files and passes when they agree", () => {
    const pkg = `${JSON.stringify({ name: "app", prettier: { semi: false } })}\n`;
    assert.deepEqual(rules({ untouched: { "package.json": pkg }, after: { ".prettierrc": '{ "semi": true }\n' } }), [
      "block:duplicated_config",
    ]);
    assert.deepEqual(
      rules({ untouched: { "package.json": pkg }, after: { ".prettierrc": '{ "semi": false }\n' } }),
      [],
    );
  });

  it("keeps an old conflict and ignores files it cannot parse", () => {
    const files = { ".prettierrc": '{ "semi": true }\n', ".prettierrc.json": '{ "semi": false }\n' };
    assert.deepEqual(
      rules({ before: files, after: { ...files, ".prettierrc": '{ "semi": true, "tabWidth": 2 }\n' } }),
      [],
    );
    assert.deepEqual(
      rules({ untouched: { ".prettierrc.json": '{ "semi": false }\n' }, after: { ".prettierrc": "semi: true\n" } }),
      [],
    );
  });
});

const complex = (key: string, cognitive: number): FunctionMetric => ({
  key,
  name: key,
  line: 1,
  lines: 10,
  params: 1,
  cognitive,
  nesting: 1,
  chain: 0,
  identifiers: 0,
});

describe("python function metrics", () => {
  it("reports a function over the complexity limit when python3 answers and skips it otherwise", () => {
    const text = "def route(a):\n    return a\n";
    const python: PythonRunner = () => [complex("route", 16)];
    assert.deepEqual(rules({ after: { "app/route.py": text }, python }), ["block:function_complexity"]);
    const skipped = analyzeDetectors(sources({ after: { "app/route.py": text } }), DEFAULT_LIMITS);
    assert.deepEqual(skipped.findings, []);
    assert.equal(skipped.pythonSkipped, true);
  });

  it("judges only what got worse", () => {
    const python: PythonRunner = (text) => [complex("route", text.includes("worse") ? 18 : 16)];
    assert.deepEqual(rules({ before: { "a.py": "old" }, after: { "a.py": "same" }, python }), []);
    assert.deepEqual(rules({ before: { "a.py": "old" }, after: { "a.py": "worse" }, python }), [
      "block:function_complexity",
    ]);
  });

  it("reads the output of the python3 script and refuses anything else", () => {
    const out = JSON.stringify([{ key: "A>m", name: "m", line: 3, lines: 12, params: 2, cognitive: 19, nesting: 5 }]);
    assert.deepEqual(parsePythonMetrics(out), [
      { key: "A>m", name: "m", line: 3, lines: 12, params: 2, cognitive: 19, nesting: 5, chain: 0, identifiers: 0 },
    ]);
    assert.equal(parsePythonMetrics("null"), undefined);
    assert.equal(parsePythonMetrics("Traceback"), undefined);
  });
});

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const ACTIVE = "guards:\n  quality: active\n  quality-detectors: active\n";

const gate = (repo: Repo, spawned: string[] = []) => {
  const base = repoRuntime();
  const runtime = {
    ...base,
    exec: (request: ExecRequest) => {
      if (request.command !== "python3") return base.exec(request);
      spawned.push(request.command);
      return { ...execResult(127), found: false };
    },
  };
  const ready = prepareGate({
    runtime,
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

describe("detectors in the quality gate", () => {
  it("blocks when active, as at the default level, and stays silent in shadow at level light", () => {
    const repo = makeRepo({ "package.json": manifest({}), ".finitemonkey/policy.yml": ACTIVE });
    repos.push(repo);
    repo.write("package.json", manifest({ leftpad: "1" }));
    const active = gate(repo);
    assert.equal(active.status, "failed");
    assert.ok(active.notes.some((item) => item.key === "gate.quality.unused_dependency"));
    repo.write(".finitemonkey/policy.yml", "guards:\n  quality: active\n");
    assert.equal(gate(repo).status, "failed");
    repo.write(".finitemonkey/policy.yml", "level: light\nguards:\n  quality: active\n");
    const shadow = gate(repo);
    assert.equal(shadow.status, "passed");
    assert.ok(!shadow.notes.some((item) => item.key === "gate.quality.unused_dependency"));
  });

  it("says Python metrics were not verified when python3 is missing", () => {
    const repo = makeRepo({ "package.json": "{}\n", ".finitemonkey/policy.yml": ACTIVE });
    repos.push(repo);
    repo.write("app/route.py", "def route(a):\n    return a\n");
    const spawned: string[] = [];
    const outcome = gate(repo, spawned);
    assert.equal(outcome.status, "passed");
    assert.ok(outcome.notes.some((item) => item.key === "gate.quality.no_python"));
    assert.deepEqual(spawned, ["python3"]);
  });
});
