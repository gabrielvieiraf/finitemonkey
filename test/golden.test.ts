import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { compareOutput } from "../src/golden/compare.js";
import { selfTarget } from "../src/guards/self/protected.js";
import { parseContract } from "../src/task/load.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const CALC = [
  'const { readFileSync } = require("node:fs");',
  "const numbers = readFileSync(process.argv[2], 'utf8').trim().split(/\\s+/).map(Number);",
  'const factor = Number(process.env.FACTOR ?? "1");',
  "console.log(`total: ${numbers.reduce((a, b) => a + b, 0) * factor}`);",
  "",
].join("\n");

const CONTRACT = [
  "id: totals",
  "goal: keep the totals right",
  "acceptance:",
  "  - id: totals",
  "    check: golden",
  "    run: node calc.js {case}",
  "    cases: golden",
  "    tolerance: 0.5",
  "",
].join("\n");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (): TempRepo => {
  const repo = tempRepo({ "calc.js": CALC, "golden/a.txt": "1 2 3\n", "golden/b.txt": "10 20\n" });
  repos.push(repo);
  trustContract(repo.root, "totals", CONTRACT);
  return repo;
};

const items = (body: unknown): readonly unknown[] => {
  const list = field(body, "data", "items");
  return Array.isArray(list) ? list : [];
};

const goldenItem = (body: unknown): unknown => items(body).find((item) => field(item, "id") === "totals");

describe("golden outputs with tolerance", () => {
  it("compares numbers within the tolerance and reports the line and the difference", () => {
    assert.equal(compareOutput("total: 6\n", "total: 6.4\r\n", 0.5), undefined);
    assert.deepEqual(compareOutput("a\ntotal: 6\n", "a\ntotal: 7\n", 0.5), {
      kind: "number",
      line: 2,
      expected: 6,
      actual: 7,
      delta: 1,
    });
    assert.deepEqual(compareOutput("total: 6\n", "sum: 6\n", 0), {
      kind: "text",
      line: 1,
      expected: "total: 6",
      actual: "sum: 6",
    });
    assert.equal(compareOutput("x  \n\n", "x\n", 0), undefined);
    assert.equal(compareOutput("x\n", "x\ny\n", 0)?.line, 2);
  });

  it("the person records expectations and the gate fails a case outside the tolerance", async () => {
    const repo = project();
    const runtime = repoRuntime();
    const accepted = await cliJson(["golden", "accept", "totals"], { cwd: repo.root, runtime, stdin: tty() });
    assert.equal(accepted.code, 0, accepted.stdout);
    assert.equal(readFileSync(join(repo.root, ".finitemonkey/golden/totals/a.txt.out"), "utf8"), "total: 6\n");
    const history = readFileSync(join(repo.root, ".finitemonkey/golden/totals/accepted.jsonl"), "utf8");
    assert.match(history, /"person":"Ana","check":"totals","case":"a.txt","before":null/);
    const clean = await cliJson(["gate"], { cwd: repo.root, runtime });
    assert.equal(field(goldenItem(clean.body), "status"), "passed");
    write(repo.root, ".finitemonkey/golden/totals/b.txt.out", "total: 29\n");
    const drift = await cliJson(["gate"], { cwd: repo.root, runtime });
    const item = goldenItem(drift.body);
    assert.equal(field(item, "status"), "failed");
    const notes = field(item, "notes");
    assert.ok(Array.isArray(notes));
    assert.deepEqual(field(notes[0], "params"), {
      case: "b.txt",
      kind: "number",
      line: 1,
      expected: 29,
      actual: 30,
      delta: 1,
    });
  });

  it("the agent cannot rewrite expectations", async () => {
    const repo = project();
    const refused = await cliJson(["golden", "accept", "totals"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: { CLAUDECODE: "1" },
      stdin: tty(),
    });
    assert.equal(field(refused.body, "error", "code"), "needs_confirmation");
    assert.equal(selfTarget(repo.root, ".finitemonkey/golden/totals/a.out"), "policy");
    assert.equal(selfTarget(repo.root, join(repo.root, ".finitemonkey", "golden", "totals", "a.out")), "policy");
  });

  it("a contract golden check must name the case placeholder", () => {
    const parsed = parseContract("totals", CONTRACT.replace(" {case}", ""));
    assert.ok(!parsed.ok);
    assert.match(JSON.stringify(parsed.error), /run: must contain \{case\}/);
  });
});
