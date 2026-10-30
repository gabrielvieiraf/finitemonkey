import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { selfGuard } from "../src/guards/self/hook.js";
import { bashSelfTargets } from "../src/guards/self/protected.js";
import { parseExamples } from "../src/task/examples.js";
import { contractHash, parseContract } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readTrust } from "../src/task/state.js";
import { bash, hook, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const contractFor = (id: string, check: string): string =>
  [
    `id: ${id}`,
    "goal: refunds go back to the card",
    "acceptance:",
    "  - id: C1",
    "    check: command",
    `    run: ${check}`,
    "",
  ].join("\n");

const JS_REFUND = [
  'const data = require("node:fs").readFileSync(0, "utf8").trim();',
  "const amount = Number(data);",
  'console.log(amount > 0 ? `refund ${amount} to card` : "nothing to refund");',
  "",
].join("\n");

const PY_REFUND = [
  "import sys",
  "amount = int(sys.stdin.read().strip())",
  'print(f"refund {amount} to card" if amount > 0 else "nothing to refund")',
  "",
].join("\n");

const python = ((): string | undefined =>
  ["python3", "python"].find((name) => spawnSync(name, ["--version"], { encoding: "utf8" }).status === 0))();

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (files: Readonly<Record<string, string>>, id: string, check: string, mode?: string): TempRepo => {
  const repo = tempRepo(files);
  repos.push(repo);
  if (mode !== undefined) write(repo.root, ".finitemonkey/policy.yml", `guards:\n  behavior-contract: ${mode}\n`);
  trustContract(repo.root, id, contractFor(id, check));
  return repo;
};

const run = (repo: TempRepo, args: readonly string[]): ReturnType<typeof cliJson> =>
  cliJson(args, { cwd: repo.root, runtime: repoRuntime() });

const item = async (repo: TempRepo, id: string): Promise<unknown> => {
  const gate = await run(repo, ["gate"]);
  const items = field(gate.body, "data", "items");
  return Array.isArray(items) ? items.find((entry) => field(entry, "id") === id) : undefined;
};

const notesOf = (entry: unknown): readonly unknown[] => {
  const notes = field(entry, "notes");
  return Array.isArray(notes) ? notes : [];
};

const keysOf = (entry: unknown): readonly unknown[] => notesOf(entry).map((entry) => field(entry, "key"));

const propose = async (repo: TempRepo, task: string, says: string, runCmd: string, input: string, expect: string) => {
  const made = await run(repo, [
    "task",
    "examples",
    task,
    "--says",
    says,
    "--run",
    runCmd,
    "--input",
    input,
    "--expect",
    expect,
  ]);
  assert.equal(made.code, 0, made.stdout);
  return made;
};

describe("behavior contract", () => {
  it("keeps the old hash when a contract has no examples", () => {
    const parsed = parseContract("r", contractFor("r", "node -v"));
    assert.ok(parsed.ok);
    assert.equal(contractHash(parsed.value, []), contractHash(parsed.value));
    const approved = parseExamples(
      "examples:\n  - id: E1\n    says: a refund\n    run: node a.js\n    expect: ok\n    status: approved\n",
    );
    assert.notEqual(contractHash(parsed.value, approved), contractHash(parsed.value));
  });

  it("approved JS examples enter the contract hash and fail the gate when the behavior changes", async () => {
    const repo = project({ "src/refund.js": JS_REFUND }, "refund", "node src/refund.js --version", "active");
    const paths = fmPaths(repo.root);
    const before = readTrust(repoRuntime(), paths).contracts["refund"];
    await propose(
      repo,
      "refund",
      "a refund of 50 returns to the same card",
      "node src/refund.js",
      "50",
      "refund 50 to card",
    );
    await propose(repo, "refund", "a refund of 0 refunds nothing", "node src/refund.js", "0", "nothing to refund");
    const pending = await item(repo, "examples");
    assert.equal(pending, undefined, "proposed examples do not run before the person approves them");
    const decided = await run(repo, ["task", "examples", "refund", "--approve", "E1,E2"]);
    assert.equal(decided.code, 0, decided.stdout);
    const after = readTrust(repoRuntime(), paths).contracts["refund"];
    assert.notEqual(after, before);
    const green = await item(repo, "examples");
    assert.equal(field(green, "status"), "passed", JSON.stringify(green));
    write(repo.root, "src/refund.js", JS_REFUND.replace("to card", "to wallet"));
    const red = await item(repo, "examples");
    assert.equal(field(red, "status"), "failed");
    const first = notesOf(red)[0];
    assert.equal(field(first, "key"), "gate.examples.failed");
    assert.equal(field(first, "params", "says"), "a refund of 50 returns to the same card");
    assert.equal(field(first, "params", "actual"), "refund 50 to wallet");
  });

  it("runs approved Python examples the same way", { skip: python === undefined }, async () => {
    const py = python ?? "python3";
    const repo = project({ "refund.py": PY_REFUND }, "pyrefund", `${py} --version`, "active");
    await propose(repo, "pyrefund", "a refund of 30 returns to the card", `${py} refund.py`, "30", "refund 30 to card");
    await run(repo, ["task", "examples", "pyrefund", "--approve", "E1"]);
    assert.equal(field(await item(repo, "examples"), "status"), "passed");
    write(repo.root, "refund.py", PY_REFUND.replace("amount > 0", "amount > 100"));
    assert.equal(field(await item(repo, "examples"), "status"), "failed");
  });

  it("only reports in shadow mode, which is the default", async () => {
    const repo = project({ "src/refund.js": JS_REFUND }, "shadowed", "node src/refund.js --version");
    await propose(repo, "shadowed", "a refund of 5 returns to the card", "node src/refund.js", "5", "refund 5 to card");
    await run(repo, ["task", "examples", "shadowed", "--approve", "E1"]);
    write(repo.root, "src/refund.js", JS_REFUND.replace("to card", "to wallet"));
    const entry = await item(repo, "examples");
    assert.equal(field(entry, "status"), "passed");
    assert.ok(keysOf(entry).includes("gate.examples.shadow"));
  });

  it("marks an example that catches no planted defect as decorative", async () => {
    const max = [
      'const [a, b] = require("node:fs").readFileSync(0, "utf8").trim().split(" ").map(Number);',
      "console.log(String(a));",
      "",
    ].join("\n");
    const repo = project({ "src/max.js": max }, "max", "node src/max.js --version", "active");
    write(repo.root, "src/max.js", max.replace("String(a)", "String(a > b ? a : b)"));
    await propose(repo, "max", "the larger of 3 and 1 is 3", "node src/max.js", "3 1", "3");
    await propose(repo, "max", "the larger of 2 and 2 is 2", "node src/max.js", "2 2", "2");
    await run(repo, ["task", "examples", "max", "--approve", "E1,E2"]);
    const entry = await item(repo, "examples");
    assert.equal(field(entry, "status"), "passed");
    const decorative = notesOf(entry).filter((note) => field(note, "key") === "gate.examples.decorative");
    assert.deepEqual(
      decorative.map((note) => field(note, "params", "id")),
      ["E2"],
    );
    const ledger = readFileSync(join(repo.root, ".finitemonkey", "log.jsonl"), "utf8");
    assert.match(ledger, /"event":"contract\.strength".*"decorative":\["E2"\]/);
  });

  it("blocks an agent that approves examples or edits them, and the gate keeps the approved copy", async () => {
    const root = toAbsolutePath("/home/ana/project");
    assert.deepEqual(
      bashSelfTargets(root, "npx finitemonkey task examples refund --approve E1").map((item) => item.kind),
      ["examples"],
    );
    assert.deepEqual(bashSelfTargets(root, "fm task examples refund --says x --run y --expect z"), []);
    const repo = project({ "src/refund.js": JS_REFUND }, "locked", "node src/refund.js --version", "active");
    await propose(repo, "locked", "a refund of 7 returns to the card", "node src/refund.js", "7", "refund 7 to card");
    await run(repo, ["task", "examples", "locked", "--approve", "E1"]);
    const denied = await hook(selfGuard, "PreToolUse", repo.root, bash("fm task examples locked --approve=E1"));
    assert.equal(denied.kind, "block");
    const edit = await hook(selfGuard, "PreToolUse", repo.root, {
      tool_name: "Edit",
      tool_input: { file_path: join(repo.root, ".finitemonkey", "tasks", "locked", "examples.yml") },
    });
    assert.equal(edit.kind, "block");
    const file = join(".finitemonkey", "tasks", "locked", "examples.yml");
    const text = readFileSync(join(repo.root, file), "utf8");
    write(repo.root, file, text.replace("refund 7 to card", "anything"));
    write(repo.root, "src/refund.js", JS_REFUND.replace("to card", "to wallet"));
    const gate = await run(repo, ["gate"]);
    assert.equal(field(gate.body, "data", "contractEdited"), true);
    const items: unknown = field(gate.body, "data", "items");
    const entry: unknown = Array.isArray(items)
      ? items.find((value: unknown) => field(value, "id") === "examples")
      : undefined;
    assert.equal(field(entry, "status"), "failed");
  });
});
