import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { applyMutant, planMutants } from "../src/mutation/operators.js";
import { parseToolReport } from "../src/mutation/report.js";
import { implicitContract } from "../src/task/implicit.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const CONTRACT = [
  "id: max",
  "goal: pick the larger number",
  "acceptance:",
  "  - id: tests",
  "    check: tests",
  "    run: node --test",
  "  - id: mutants",
  "    check: mutation",
  "    min_score: 60",
  "",
].join("\n");

const test = (body: string): string =>
  [
    'const { test } = require("node:test");',
    'const assert = require("node:assert");',
    'const { max } = require("../src/max.js");',
    `test("max", () => { ${body} });`,
    "",
  ].join("\n");

const WEAK = test('assert.equal(typeof max(1, 2), "number");');
const STRONG = test("assert.equal(max(1, 2), 2); assert.equal(max(3, 1), 3);");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (spec: string): TempRepo => {
  const repo = tempRepo({ "src/max.js": "module.exports.max = (a) => a;\n", "test/max.test.js": WEAK });
  repos.push(repo);
  trustContract(repo.root, "max", CONTRACT);
  write(repo.root, "src/max.js", "module.exports.max = (a, b) => (a > b ? a : b);\n");
  write(repo.root, "test/max.test.js", spec);
  return repo;
};

const mutationItem = async (repo: TempRepo): Promise<unknown> => {
  const run = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime() });
  const items = field(run.body, "data", "items");
  return Array.isArray(items) ? items.find((item) => field(item, "id") === "mutants") : undefined;
};

describe("mutation check", () => {
  it("mutates changed source lines only, never tests or comments", () => {
    const mutants = planMutants(
      [
        { path: "src/a.ts", line: 3, text: "  return a > b && ok;" },
        { path: "src/a.ts", line: 4, text: "  // a > b" },
        { path: "test/a.test.ts", line: 1, text: "assert.ok(a > b);" },
        { path: "app/m.py", line: 2, text: "    return x == 1 and y" },
      ],
      10,
    );
    assert.deepEqual(
      mutants.map((mutant) => `${mutant.file}:${String(mutant.line)} ${mutant.operator}`),
      ["src/a.ts:3 > → <=", "app/m.py:2 == → !=", "src/a.ts:3 && → ||", "app/m.py:2 and → or"],
    );
    const first = mutants[0];
    assert.ok(first !== undefined);
    assert.equal(applyMutant("x\ny\n  return a > b && ok;\n", first), "x\ny\n  return a <= b && ok;\n");
    assert.equal(applyMutant("x\ny\n  changed\n", first), undefined);
  });

  it("reads the report of an installed mutation tool", () => {
    const report = JSON.stringify({
      files: {
        "src/a.ts": {
          mutants: [
            { status: "Killed", mutatorName: "EqualityOperator", location: { start: { line: 2 } } },
            { status: "Survived", mutatorName: "BooleanLiteral", location: { start: { line: 7 } } },
          ],
        },
      },
    });
    const counts = parseToolReport(report);
    assert.ok(counts !== undefined);
    assert.equal(counts.killed, 1);
    assert.deepEqual(
      counts.survived.map((mutant) => [mutant.file, mutant.line, mutant.operator]),
      [["src/a.ts", 7, "BooleanLiteral"]],
    );
  });

  it("reports the surviving mutant with file and line when the tests cannot catch it", async () => {
    const item = await mutationItem(project(WEAK));
    assert.equal(field(item, "status"), "failed");
    const notes = field(item, "notes");
    assert.ok(Array.isArray(notes));
    assert.deepEqual(field(notes[1], "params"), { file: "src/max.js", line: 1, operator: "> → <=" });
  });

  it("passes when the tests kill the mutants", async () => {
    const item = await mutationItem(project(STRONG));
    assert.equal(field(item, "status"), "passed");
  });

  it("is off unless the contract asks for it", () => {
    const contract = implicitContract({ read: () => '{"scripts":{"test":"node --test"}}', exists: () => true });
    assert.ok(contract.acceptance.every((check) => check.kind !== "mutation"));
  });
});
