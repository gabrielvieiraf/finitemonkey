import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { deepArgs, deepLines, parseDeep } from "../src/look/deep.js";
import { deepRunner } from "../src/look/node-deep.js";
import { execResult, fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath(join("/home", "ana", "app"));
const BIN = join(ROOT, "node_modules", ".bin", "lighthouse");
const REPORT = JSON.stringify({
  categories: { performance: { score: 0.91 }, accessibility: { score: 1 }, "best-practices": { score: 0.5 } },
});

describe("look --deep", () => {
  it("turns error reporting off and asks only for the scored categories", () => {
    const args = deepArgs("http://127.0.0.1:3000/");
    assert.ok(args.includes("--no-enable-error-reporting"));
    assert.ok(args.includes("--output=json"));
    assert.equal(args[0], "http://127.0.0.1:3000/");
  });

  it("reads category scores from 0 to 100 and ignores a broken report", () => {
    assert.deepEqual(parseDeep(REPORT), [
      { category: "performance", score: 91 },
      { category: "accessibility", score: 100 },
      { category: "best-practices", score: 50 },
    ]);
    assert.equal(parseDeep("not json"), undefined);
  });

  it("runs the project's lighthouse once per route against the loopback app", () => {
    const calls: ExecRequest[] = [];
    const runtime = fakeRuntime({
      files: { [BIN]: "#!/bin/sh\n" },
      exec: (request) => {
        calls.push(request);
        return request.args[0]?.endsWith("/broken") === true
          ? execResult(1, "", "Chrome failed")
          : execResult(0, REPORT);
      },
    });
    const report = deepRunner(runtime, ROOT)("http://127.0.0.1:3000", ["/", "/broken"]);
    assert.equal(report.tool, "lighthouse");
    assert.deepEqual(
      calls.map((call) => call.args[0]),
      ["http://127.0.0.1:3000/", "http://127.0.0.1:3000/broken"],
    );
    assert.deepEqual(deepLines(report), [
      "lighthouse /: performance 91, accessibility 100, best-practices 50",
      "lighthouse /broken: exit 1: Chrome failed",
    ]);
  });

  it("without lighthouse in the project nothing runs", () => {
    const calls: ExecRequest[] = [];
    const runtime = fakeRuntime({
      exec: (request) => {
        calls.push(request);
        return execResult(0, REPORT);
      },
    });
    assert.deepEqual(deepRunner(runtime, ROOT)("http://127.0.0.1:3000", ["/"]), { tool: null, routes: [] });
    assert.equal(calls.length, 0);
  });
});
