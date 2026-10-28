import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { newLogic } from "../src/organize/move.js";
import { responsibilities } from "../src/organize/plan.js";
import { git, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const FUNCTIONS = 60;
const BODY = 26;

const fn = (index: number): string =>
  [
    `export function f${String(index)}(x) {`,
    "  let total = x;",
    ...Array.from({ length: BODY }, (_, step) => `  total = total + ${String(index * 100 + step)};`),
    "  return total;",
    "}",
  ].join("\n");

const BIG = `${Array.from({ length: FUNCTIONS }, (_, index) => fn(index + 1)).join("\n")}\n`;
const USE = 'import { f1, f45 } from "./big.js";\nexport const use = (x) => f1(x) + f45(x);\n';
const TEST = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { f1, f45 } from "../src/big.js";',
  'test("f1", () => { assert.equal(f1(0), 2925); });',
  'test("f45", () => { assert.equal(f45(0), 117325); });',
  "",
].join("\n");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const bigRepo = (): TempRepo => {
  const repo = tempRepo({
    "package.json": '{ "type": "module", "scripts": { "test": "node --test" } }\n',
    "src/big.js": BIG,
    "src/use.js": USE,
    "test/big.test.js": TEST,
  });
  repos.push(repo);
  return repo;
};

const extractFirstGroup = (repo: TempRepo, edit: (moved: string) => string = (moved) => moved): void => {
  const lines = BIG.split("\n");
  const moved = lines.slice(0, 300).join("\n");
  const names = Array.from({ length: 10 }, (_, index) => `f${String(index + 1)}`).join(", ");
  write(repo.root, "src/big/f1.js", `${edit(moved)}\n`);
  write(repo.root, "src/big.js", `export { ${names} } from "./big/f1.js";\n${lines.slice(300).join("\n")}`);
};

const statuses = async (repo: TempRepo): Promise<Readonly<Record<string, unknown>>> => {
  const run = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime() });
  const items = field(run.body, "data", "items");
  const list: readonly unknown[] = Array.isArray(items) ? items : [];
  return Object.fromEntries(list.map((item): [string, unknown] => [String(field(item, "id")), item]));
};

describe("organize", () => {
  it("ranks hotspots the same way for the same history", async () => {
    const repo = bigRepo();
    write(repo.root, "src/use.js", `${USE}export const twice = (x) => (x > 1 ? use(x) : 0);\n`);
    git(repo.root, "commit", "-qam", "fix: twice");
    const first = await cliJson(["organize"], { cwd: repo.root, runtime: repoRuntime() });
    rmSync(join(repo.root, ".finitemonkey", "cache"), { recursive: true, force: true });
    const second = await cliJson(["organize"], { cwd: repo.root, runtime: repoRuntime() });
    assert.deepEqual(field(first.body, "data", "hotspots"), field(second.body, "data", "hotspots"));
    const hotspots = field(first.body, "data", "hotspots");
    assert.ok(Array.isArray(hotspots));
    assert.deepEqual(
      hotspots.map((item) => field(item, "path")),
      ["src/big.js", "src/use.js"],
    );
    assert.equal(field(hotspots[1], "fixes"), 1);
  });

  it("splits an 1,800-line file with no open caller and no edited test", async () => {
    const repo = bigRepo();
    assert.equal(BIG.split("\n").length - 1, 1800);
    const planned = await cliJson(["organize", "plan", "src/big.js"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(planned.code, 0, planned.stdout);
    const plan = readFileSync(join(repo.root, "docs/organize/src-big.js.md"), "utf8");
    assert.match(
      plan,
      /## Step 2: Extract lines 1-300 \(f1, f2, f3, f4, f5, f6, f7, f8, f9, f10\) to src\/big\/f1\.js/,
    );
    const step = await cliJson(["organize", "step", "src/big.js", "2"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(step.body, "data", "task"), "organize-src-big-js-2");
    extractFirstGroup(repo);
    const items = await statuses(repo);
    for (const id of ["test", "callers", "organize"]) assert.equal(field(items[id], "status"), "passed", id);
    assert.equal(readFileSync(join(repo.root, "test/big.test.js"), "utf8"), TEST);
  });

  it("fails a step that mixes moving with changing logic", async () => {
    const repo = bigRepo();
    await cliJson(["organize", "plan", "src/big.js"], { cwd: repo.root, runtime: repoRuntime() });
    await cliJson(["organize", "step", "src/big.js", "2"], { cwd: repo.root, runtime: repoRuntime() });
    extractFirstGroup(repo, (moved) => moved.replace("  total = total + 105;", "  total = total * 105;"));
    const organize = (await statuses(repo))["organize"];
    assert.equal(field(organize, "status"), "failed");
    const notes = field(organize, "notes");
    assert.ok(Array.isArray(notes));
    assert.deepEqual(field(notes[0], "params"), { file: "src/big/f1.js", line: 8, text: "total = total * 105;" });
  });

  it("fails a step that removes a re-export while a caller still uses it", async () => {
    const repo = bigRepo();
    write(repo.root, "src/big.js", `export { f1 } from "./big/f1.js";\n${BIG.split("\n").slice(30).join("\n")}`);
    write(repo.root, "src/big/f1.js", `${fn(1)}\n`);
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-qm", "extract f1");
    await cliJson(["organize", "plan", "src/big.js"], { cwd: repo.root, runtime: repoRuntime() });
    await cliJson(["organize", "step", "src/big.js", "1"], { cwd: repo.root, runtime: repoRuntime() });
    write(repo.root, "src/big.js", BIG.split("\n").slice(30).join("\n"));
    const organize = (await statuses(repo))["organize"];
    assert.equal(field(organize, "status"), "failed");
    assert.match(JSON.stringify(field(organize, "notes")), /gate\.organize\.open_caller.*"name":"f1"/);
  });

  it("allows at most three open targets per round", async () => {
    const repo = bigRepo();
    for (const file of ["a", "b", "c", "d"]) write(repo.root, `src/${file}.js`, "export const x = 1;\n");
    const runs = [];
    for (const file of ["a", "b", "c", "d"]) {
      runs.push(await cliJson(["organize", "plan", `src/${file}.js`], { cwd: repo.root, runtime: repoRuntime() }));
    }
    assert.deepEqual(
      runs.map((run) => run.code),
      [0, 0, 0, 2],
    );
  });

  it("groups top-level declarations into responsibilities with line ranges", () => {
    const parts = responsibilities("src/big.js", BIG);
    assert.equal(parts.length, 6);
    assert.deepEqual([parts[1]?.start, parts[1]?.end], [301, 600]);
    assert.deepEqual(newLogic([{ path: "a.js", before: "export const a = 1;\n", after: "export const a = 1;\n" }]), []);
  });
});
