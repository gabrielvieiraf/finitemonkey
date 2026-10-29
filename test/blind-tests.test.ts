import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { buildPacket } from "../src/blind/blind.js";
import { parseContract } from "../src/task/load.js";
import { git, tempDir, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const STUB = "module.exports.max = () => 0;\n";
const BUGGY = "module.exports.max = (a, b) => (a < b ? a : b);\n";
const RIGHT = "module.exports.max = (a, b) => (a > b ? a : b);\n";

const CONTRACT = [
  "id: max",
  "goal: return the larger of two numbers",
  "size: M",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node --version",
  "  - id: M1",
  "    check: manual",
  "    description: max(3, 1) is 3 and max(1, 3) is 3",
  "",
].join("\n");

const TESTS = JSON.stringify({
  tests: [
    {
      name: "larger first",
      file: "blind/larger.test.js",
      content:
        'const { max } = require("../src/max.js"); if (max(3, 1) !== 3) { console.log("max(3,1) =", max(3, 1)); process.exit(1); }\n',
      run: "node blind/larger.test.js",
    },
    {
      name: "exists",
      file: "blind/exists.test.js",
      content: 'const { max } = require("../src/max.js"); if (typeof max !== "function") process.exit(1);\n',
      run: "node blind/exists.test.js",
    },
  ],
});

const repos: TempRepo[] = [];
const dirs: string[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const project = (head: string): { readonly repo: TempRepo; readonly seen: string } => {
  const repo = tempRepo({ "src/max.js": STUB });
  repos.push(repo);
  const tools = tempDir("fm-blind-writer-");
  dirs.push(tools);
  const seen = join(tools, "packet.json");
  write(
    tools,
    "writer.cjs",
    [
      'const fs = require("node:fs");',
      'const packet = fs.readFileSync(0, "utf8");',
      `fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ packet, source: fs.readFileSync("src/max.js", "utf8") }));`,
      `process.stdout.write(${JSON.stringify(TESTS)});`,
      "",
    ].join("\n"),
  );
  write(
    repo.root,
    ".finitemonkey/config.yml",
    `blind:\n  writer: node ${JSON.stringify(join(tools, "writer.cjs").replaceAll("\\", "/"))}\n`,
  );
  write(repo.root, ".finitemonkey/policy.yml", "guards:\n  blind-tests: active\n");
  trustContract(repo.root, "max", CONTRACT.replace("id: max", `id: max\nbase: ${git(repo.root, "rev-parse", "HEAD")}`));
  write(repo.root, "src/max.js", head);
  return { repo, seen };
};

const blindItem = async (repo: TempRepo): Promise<unknown> => {
  const gate = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime() });
  const items = field(gate.body, "data", "items");
  return Array.isArray(items) ? items.find((item: unknown) => field(item, "id") === "blind-tests") : undefined;
};

const notes = (entry: unknown): readonly unknown[] => {
  const list = field(entry, "notes");
  return Array.isArray(list) ? list : [];
};

describe("blind tests", () => {
  it("builds a packet from the contract and base only, with no diff", () => {
    const parsed = parseContract("max", CONTRACT);
    assert.ok(parsed.ok);
    const packet = buildPacket(parsed.value, "abc123", []);
    assert.deepEqual(Object.keys(packet).sort(), ["base", "criteria", "examples", "goal", "schema", "task"]);
    assert.doesNotMatch(JSON.stringify(packet), /diff|@@|a > b|a < b/);
  });

  it("catches a seeded bug and discards the tests that already pass on base", async () => {
    const { repo, seen } = project(BUGGY);
    const entry = await blindItem(repo);
    assert.equal(field(entry, "status"), "failed", JSON.stringify(entry));
    const summary = notes(entry)[0];
    assert.equal(field(summary, "key"), "gate.blind.summary");
    assert.deepEqual(field(summary, "params"), { kept: 1, discarded: 1 });
    const disagreement = notes(entry).find((item) => field(item, "key") === "gate.blind.disagree");
    assert.equal(field(disagreement, "params", "name"), "larger first");
    assert.match(String(field(disagreement, "params", "head")), /max\(3,1\) = 1/);
    const recorded = readFileSync(seen, "utf8");
    assert.doesNotMatch(recorded, /a < b/, "the writer never sees the change");
    assert.match(recorded, /\(\) => 0/, "the writer works on the base commit");
    assert.equal(git(repo.root, "status", "--porcelain", "--", "blind"), "", "blind tests are never left in the repo");
  });

  it("passes when the implementation meets the contract", async () => {
    const { repo } = project(RIGHT);
    const entry = await blindItem(repo);
    assert.equal(field(entry, "status"), "passed", JSON.stringify(entry));
  });
});
