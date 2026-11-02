import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { buildBundleSize } from "../src/look/bundle.js";
import { parseLookConfig } from "../src/look/config.js";
import { perfOutcome, type Sample } from "../src/look/perf.js";
import { withBuildBundle } from "../src/look/perf-run.js";
import { countQueries, fileQueryLog, queryShape } from "../src/look/queries.js";
import { fakeRuntime, ROOT } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures");
const at = (...parts: readonly string[]) => toAbsolutePath(join(FIXTURES, ...parts));
const bytesOf = (root: string, files: readonly string[]): number =>
  files.reduce((sum, file) => sum + statSync(join(root, file)).size, 0);

const sample = (overrides: Partial<Sample> = {}): Sample => ({
  lcp: 400,
  cls: 0,
  tbt: 0,
  js: 2000,
  queries: 2,
  ...overrides,
});

describe("perf: bundle size from the build manifest", () => {
  it("sums every script a Vite manifest lists and leaves styles out", () => {
    const root = at("look-bundle", "vite");
    const size = buildBundleSize(nodeRuntime(), root);
    const files = ["assets/index-a1.js", "assets/lazy-d4.js", "assets/vendor-b2.js"];
    assert.ok(size);
    assert.deepEqual(size.files, files);
    assert.equal(size.kind, "vite");
    assert.equal(size.manifest, "dist/.vite/manifest.json");
    assert.equal(size.bytes, bytesOf(join(root, "dist"), files));
  });

  it("sums the unique chunks a Next build manifest lists", () => {
    const root = at("look-bundle", "next");
    const size = buildBundleSize(nodeRuntime(), root);
    const files = [
      "static/chunks/main-3.js",
      "static/chunks/pages/index-4.js",
      "static/chunks/polyfills-1.js",
      "static/chunks/webpack-2.js",
    ];
    assert.ok(size);
    assert.deepEqual(size.files, files);
    assert.equal(size.bytes, bytesOf(join(root, ".next"), files));
  });

  it("a declared manifest path wins and a missing build gives no size", () => {
    const root = at("look-bundle", "vite");
    assert.equal(buildBundleSize(nodeRuntime(), root, "dist/.vite/manifest.json")?.files.length, 3);
    assert.equal(buildBundleSize(nodeRuntime(), at("look-frameworks", "vite")), undefined);
  });

  it("the build size replaces loaded bytes only when look.yml asks for it", () => {
    assert.equal(parseLookConfig("port: 3000\n").perf.bundle, "loaded");
    assert.equal(parseLookConfig("port: 3000\nperf:\n  bundle: build\n").perf.bundle, "build");
    const measures = [{ route: "/", samples: [sample(), sample({ js: 10 })], action: undefined }];
    assert.deepEqual(
      withBuildBundle(measures, 777)[0]?.samples.map((item) => item.js),
      [777, 777],
    );
    assert.equal(withBuildBundle(measures, undefined), measures);
  });
});

describe("perf: query counts from a SQL log", () => {
  const log = readFileSync(join(FIXTURES, "look-queries", "n-plus-one.log"), "utf8");

  it("literals collapse into one shape", () => {
    assert.equal(queryShape("SELECT * FROM users WHERE id = 42"), "select * from users where id = ?");
    assert.equal(
      queryShape("select * from t where name = 'Ana' and k in (1, 2, 3);"),
      queryShape("SELECT * FROM t WHERE name = 'Bo' AND k IN (9)"),
    );
  });

  it("an N+1 loop in the fixture log is counted and reported", () => {
    const counted = countQueries(log);
    assert.equal(counted.total, 8);
    assert.deepEqual(counted.repeated, [{ shape: "select * from users where id = ?", count: 6 }]);
    const outcome = perfOutcome(
      [
        {
          route: "/posts",
          samples: [sample({ queries: counted.total })],
          action: undefined,
          repeated: counted.repeated,
        },
      ],
      { routes: {}, accepted: [] },
      "t1",
      "now",
    );
    const issues = outcome.pages.flatMap((page) => page.issues);
    assert.deepEqual(
      issues.map((item) => [item.rule, item.selector]),
      [["perf/n-plus-one", "select * from users where id = ?"]],
    );
    assert.equal(outcome.pages[0]?.metrics?.["queries"], 8);
  });

  it("only the lines written after the mark count for a request", () => {
    const path = toAbsolutePath("/project/log/sql.log");
    const runtime = fakeRuntime({ files: { [path]: "SELECT 1\n" } });
    const reader = fileQueryLog(runtime, path);
    const mark = reader.mark();
    runtime.writeText(path, `SELECT 1\n${log}`);
    assert.equal(reader.since(mark).total, 8);
    assert.equal(parseLookConfig("port: 1\nperf:\n  queries_log: log/sql.log\n").perf.queriesLog, "log/sql.log");
  });
});
