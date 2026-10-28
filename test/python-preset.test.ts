import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { format } from "prettier";

import type { AbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { compareTestFile } from "../src/guards/tests/analyze.js";
import { detectChecks } from "../src/task/implicit.js";
import { tempDir } from "./git-support.js";
import { cliJson, field } from "./support.js";

const PYPROJECT = '[project]\nname = "shop"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n';
const TEST = "from shop import total\n\n\ndef test_total() -> None:\n    assert total([1, 2]) == 3\n";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const project = (files: Readonly<Record<string, string>>): AbsolutePath => {
  const dir = tempDir("fm-py-");
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

const SAMPLE = {
  "pyproject.toml": PYPROJECT,
  "uv.lock": "version = 1\n",
  "src/shop/__init__.py": "def total(items: list[int]) -> int:\n    return sum(items)\n",
  "tests/test_total.py": TEST,
};

const pythonBin = ["python3", "python"].find((name) => spawnSync(name, ["--version"]).status === 0);

describe("Python preset", () => {
  it("writes ruff, pytest, the no-comments checker and a uv CI that prettier keeps", async () => {
    const dir = project(SAMPLE);
    const run = await cliJson(["preset", "python", "--write"], { cwd: dir, runtime: nodeRuntime() });
    assert.equal(run.code, 0, run.stdout);
    assert.deepEqual(field(run.body, "data", "written"), [
      "ruff.toml",
      "pytest.ini",
      "scripts/check_no_comments.py",
      ".github/workflows/ci.yml",
    ]);
    const ci = readFileSync(join(dir, ".github/workflows/ci.yml"), "utf8");
    assert.equal(await format(ci, { parser: "yaml" }), ci);
    assert.match(ci, /- run: uv sync --locked\n/);
    for (const line of ci.split("\n").filter((item) => item.includes("uses:"))) assert.match(line, /@[0-9a-f]{40} # v/);
    assert.ok(
      ci
        .split("\n")
        .filter((line) => line.includes("run:"))
        .every((line) => !line.includes("${{")),
    );
    assert.match(readFileSync(join(dir, "ruff.toml"), "utf8"), /max-complexity = 10/);
    assert.match(readFileSync(join(dir, "pytest.ini"), "utf8"), /--strict-markers/);
  });

  it("keeps an existing ruff section and proposes a diff for an existing CI file", async () => {
    const dir = project({
      ...SAMPLE,
      "pyproject.toml": `${PYPROJECT}\n[tool.ruff.lint]\nselect = ["E"]\n`,
      ".github/workflows/ci.yml": "name: ci\n",
    });
    const run = await cliJson(["preset", "python", "--write"], { cwd: dir, runtime: nodeRuntime() });
    assert.deepEqual(field(run.body, "data", "proposed"), [".github/workflows/ci.yml"]);
    assert.equal(readFileSync(join(dir, ".github/workflows/ci.yml"), "utf8"), "name: ci\n");
    const files = field(run.body, "data", "files");
    assert.ok(Array.isArray(files) && files.every((item) => field(item, "path") !== "ruff.toml"));
  });

  it("the no-comments checker flags a comment with file and line", { skip: pythonBin === undefined }, async () => {
    const dir = project(SAMPLE);
    await cliJson(["preset", "python", "--write"], { cwd: dir, runtime: nodeRuntime() });
    const clean = spawnSync(pythonBin ?? "python3", ["scripts/check_no_comments.py"], { cwd: dir, encoding: "utf8" });
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    writeFileSync(join(dir, "src/shop/__init__.py"), "def total(items):\n    return sum(items)  # adds\n");
    const dirty = spawnSync(pythonBin ?? "python3", ["scripts/check_no_comments.py"], { cwd: dir, encoding: "utf8" });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stdout, /src[\\/]shop[\\/]__init__\.py:2: comment/);
  });

  it("the tests guard catches pytest.mark.skip and a removed assert", () => {
    const skipped = TEST.replace("def test_total", "import pytest\n\n\n@pytest.mark.skip\ndef test_total");
    assert.deepEqual(
      compareTestFile("tests/test_total.py", TEST, skipped).map((item) => item.kind),
      ["skip_added"],
    );
    const hollow = TEST.replace("    assert total([1, 2]) == 3\n", "    total([1, 2])\n");
    assert.deepEqual(
      compareTestFile("tests/test_total.py", TEST, hollow).map((item) => item.kind),
      ["assertion_removed"],
    );
  });

  it("the implicit contract runs ruff and pytest through uv", () => {
    const files = new Map([...Object.entries(SAMPLE), ["ruff.toml", ""]]);
    const checks = detectChecks({ read: (path) => files.get(path), exists: (path) => files.has(path) });
    assert.deepEqual(
      checks.map((check) => check.run),
      ["uv run ruff check .", "uv run pytest -q"],
    );
  });
});
