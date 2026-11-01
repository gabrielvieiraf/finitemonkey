import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { apiFindings } from "../src/deps/api-version.js";
import { memoryFs } from "./memory-fs.js";
import { execResult, fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath("/p");
const at = (path: string): string => toAbsolutePath(join(ROOT, path));

const runtimeWith = (files: Readonly<Record<string, string>>, calls: string[] = []) => {
  const fs = memoryFs(Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])));
  const base = fakeRuntime({ fs });
  return {
    ...base,
    exec: (request: { readonly command: string }) => {
      calls.push(request.command);
      return execResult(1);
    },
  };
};

const npm = (name: string, version: string, dts: string, locked = version): Readonly<Record<string, string>> => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version, types: "index.d.ts" }),
  [`node_modules/${name}/index.d.ts`]: dts,
  "package-lock.json": JSON.stringify({ packages: { [`node_modules/${name}`]: { version: locked } } }),
});

const kinds = (runtime: ReturnType<typeof runtimeWith>, path: string, text: string) =>
  apiFindings(runtime, ROOT, [{ path, text }]).map((finding) => [
    finding.kind,
    finding.symbol,
    finding.version,
    finding.detail,
  ]);

const PY_SITE = ".venv/lib/python3.12/site-packages";

describe("library calls against the installed version", () => {
  it("reports a function removed in the installed major version, with the version", () => {
    const runtime = runtimeWith(npm("chrono", "3.0.0", "export declare function parse(text: string): Date;\n"));
    assert.deepEqual(kinds(runtime, "src/a.js", 'import { parseDate } from "chrono";\nparseDate("x");\n'), [
      ["missing", "parseDate", "3.0.0", ""],
    ]);
    assert.deepEqual(kinds(runtime, "src/a.js", 'import { parse } from "chrono";\nparse("x");\n'), []);
  });

  it("reports too many arguments and a deprecated function as a warning", () => {
    const dts = [
      "export declare function f(a: string, b?: number): void;",
      "/** @deprecated use f */",
      "export declare function old(a: string): void;",
    ].join("\n");
    const runtime = runtimeWith(npm("lib", "1.2.0", dts));
    assert.deepEqual(kinds(runtime, "a.mjs", 'import { f, old } from "lib";\nf("a", 1, 2);\nold("x");\n'), [
      ["arity", "f", "1.2.0", "3 > 2"],
      ["deprecated", "old", "1.2.0", ""],
    ]);
  });

  it("an export the declarations hide behind a re-export resolves to uncertain", () => {
    const runtime = runtimeWith(npm("plug", "2.0.0", 'export * from "./impl";\n'));
    assert.deepEqual(
      kinds(runtime, "a.js", 'const { register } = require("plug");\nregister();\n').map(([kind]) => kind),
      ["uncertain"],
    );
  });

  it("an installed version different from the lockfile is not verified", () => {
    const runtime = runtimeWith(npm("chrono", "3.0.0", "export declare function parse(): void;\n", "2.9.0"));
    assert.equal(kinds(runtime, "a.js", 'import { parse } from "chrono";\n')[0]?.[0], "not_verified");
  });

  it("reports an unknown keyword argument in Python, and leaves __getattr__ modules uncertain", () => {
    const runtime = runtimeWith({
      [`${PY_SITE}/reqs/__init__.py`]: "def get(url, params=None, *, timeout=None):\n    pass\n",
      [`${PY_SITE}/reqs-2.31.0.dist-info/METADATA`]: "Version: 2.31.0\n",
      [`${PY_SITE}/lazy/__init__.py`]: "def __getattr__(name):\n    return name\n",
      "requirements.txt": "reqs==2.31.0\n",
    });
    assert.deepEqual(kinds(runtime, "app.py", "from reqs import get\nget('u', tmeout=3)\nget('u', timeout=3)\n"), [
      ["keyword", "get", "2.31.0", "tmeout"],
    ]);
    assert.equal(kinds(runtime, "app.py", "from lazy import thing\nthing()\n")[0]?.[0], "uncertain");
  });

  it("reports a function removed in a JS package without type files, with the version", () => {
    const runtime = runtimeWith({
      "node_modules/slugs/package.json": JSON.stringify({ name: "slugs", version: "4.1.0", main: "lib/main" }),
      "node_modules/slugs/lib/main.js": [
        '"use strict";',
        'Object.defineProperty(exports, "__esModule", { value: true });',
        "exports.slugify = exports.trim = void 0;",
        "function slugify(text, separator) { return text; }",
        "exports.slugify = slugify;",
        "const trim = (text) => text.trim();",
        "exports.trim = trim;",
      ].join("\n"),
    });
    assert.deepEqual(kinds(runtime, "src/a.js", 'import { toSlug } from "slugs";\ntoSlug("x");\n'), [
      ["missing", "toSlug", "4.1.0", ""],
    ]);
    assert.deepEqual(
      kinds(runtime, "src/a.js", 'const { slugify, trim } = require("slugs");\nslugify("a", "-", 3);\n'),
      [["arity", "slugify", "4.1.0", "3 > 2"]],
    );
  });

  it("reads ESM exports and module.exports objects from package source", () => {
    const runtime = runtimeWith({
      "node_modules/esm-lib/package.json": JSON.stringify({
        name: "esm-lib",
        version: "2.0.0",
        exports: { ".": { import: "./src/index.mjs" } },
      }),
      "node_modules/esm-lib/src/index.mjs": "export function one(a) {}\nexport const two = (a, b = 1) => a;\n",
      "node_modules/cjs-lib/package.json": JSON.stringify({ name: "cjs-lib", version: "1.0.0" }),
      "node_modules/cjs-lib/index.js": "function run(task) {}\nmodule.exports = { run, stop: function (id) {} };\n",
      "node_modules/whole/package.json": JSON.stringify({ name: "whole", version: "1.0.0" }),
      "node_modules/whole/index.js": "module.exports = makeThing();\n",
    });
    assert.deepEqual(kinds(runtime, "a.mjs", 'import { one, two, three } from "esm-lib";\none(1, 2);\ntwo(1, 2);\n'), [
      ["arity", "one", "2.0.0", "2 > 1"],
      ["missing", "three", "2.0.0", ""],
    ]);
    assert.deepEqual(kinds(runtime, "a.js", 'const { run, stop } = require("cjs-lib");\nrun(1, 2);\nstop(1);\n'), [
      ["arity", "run", "1.0.0", "2 > 1"],
    ]);
    assert.equal(kinds(runtime, "a.js", 'const { make } = require("whole");\n')[0]?.[0], "uncertain");
  });

  it("resolves a Python function re-exported two levels deep", () => {
    const runtime = runtimeWith({
      [`${PY_SITE}/deep/__init__.py`]: "from .api import fetch\n",
      [`${PY_SITE}/deep/api/__init__.py`]: "from .core import fetch as fetch\n",
      [`${PY_SITE}/deep/api/core.py`]: "def fetch(url, *, retries=0):\n    pass\n",
      [`${PY_SITE}/deep-1.4.0.dist-info/METADATA`]: "Version: 1.4.0\n",
    });
    assert.deepEqual(kinds(runtime, "app.py", "from deep import fetch\nfetch('u', 'v')\nfetch('u', retry=1)\n"), [
      ["arity", "fetch", "1.4.0", "2 > 1"],
      ["keyword", "fetch", "1.4.0", "retry"],
    ]);
  });

  it("never executes installed package code", () => {
    const calls: string[] = [];
    const runtime = runtimeWith(
      {
        ...npm("chrono", "3.0.0", "export declare function parse(): void;\n"),
        [`${PY_SITE}/reqs/__init__.py`]: "from .inner import get\n",
        [`${PY_SITE}/reqs/inner.py`]: "def get(url):\n    pass\n",
        "node_modules/plain/package.json": JSON.stringify({ name: "plain", version: "1.0.0" }),
        "node_modules/plain/index.js": "exports.go = function (a) {};\n",
      },
      calls,
    );
    apiFindings(runtime, ROOT, [
      { path: "a.js", text: 'import { parse } from "chrono";\nparse();\n' },
      { path: "c.js", text: 'const { go } = require("plain");\ngo(1);\n' },
      { path: "b.py", text: "from reqs import get\nget('x')\n" },
    ]);
    assert.deepEqual(calls, []);
  });
});
