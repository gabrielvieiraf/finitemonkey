import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const MAX = [
  "export function larger(a, b) {",
  "  return a > b ? a : b;",
  "}",
  "",
  "export function smaller(a, b) {",
  "  return a < b ? a : b;",
  "}",
  "",
].join("\n");

const CONTRACT = [
  "id: t",
  "goal: compare numbers",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node --version",
  "",
].join("\n");

const LARGER_CHECK = `node --input-type=module -e "import('./src/max.mjs').then((m) => process.exit(m.larger(3, 1) === 3 && m.larger(1, 3) === 3 ? 0 : 1))"`;
const ALWAYS = `node -e "process.exit(0)"`;

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (mode = "active"): TempRepo => {
  const repo = tempRepo({ "src/max.mjs": MAX, "src/other.mjs": "export const other = 1;\n" });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", `guards:\n  claim-checks: ${mode}\n`);
  trustContract(repo.root, "t", CONTRACT);
  return repo;
};

const run = (repo: TempRepo, args: readonly string[]) => cliJson(args, { cwd: repo.root, runtime: repoRuntime() });

const add = async (repo: TempRepo, ...args: readonly string[]): Promise<string> => {
  const added = await run(repo, ["claims", "add", ...args]);
  assert.equal(added.code, 0, added.stdout);
  return String(field(added.body, "data", "id"));
};

const claimsItem = async (repo: TempRepo): Promise<unknown> => {
  const gate = await run(repo, ["gate"]);
  const items = field(gate.body, "data", "items");
  return Array.isArray(items) ? items.find((entry) => field(entry, "id") === "claims") : undefined;
};

const notes = (entry: unknown): readonly unknown[] => {
  const list = field(entry, "notes");
  return Array.isArray(list) ? list : [];
};

const keys = (entry: unknown): readonly unknown[] => notes(entry).map((item) => field(item, "key"));

describe("executable claims at the gate", () => {
  it("renews a passing check at the current tree and fails the gate with the claim text when it breaks", async () => {
    const repo = project();
    const id = await add(
      repo,
      "larger returns the bigger number",
      "--anchor",
      "src/max.mjs#larger",
      "--check",
      LARGER_CHECK,
    );
    write(repo.root, "src/max.mjs", MAX.replace("a > b ? a : b", "Math.max(a, b)"));
    const green = await claimsItem(repo);
    assert.equal(field(green, "status"), "passed", JSON.stringify(green));
    const log = readFileSync(join(repo.root, ".finitemonkey/claims.jsonl"), "utf8");
    assert.match(log, new RegExp(`"event":"renew","id":"${id}".*"reason":"check_passed"`));
    write(repo.root, "src/max.mjs", MAX.replace("a > b ? a : b", "a"));
    const red = await claimsItem(repo);
    assert.equal(field(red, "status"), "failed");
    const failedNote = notes(red).find((item) => field(item, "key") === "gate.claims.failed");
    assert.equal(field(failedNote, "params", "text"), "larger returns the bigger number");
  });

  it("shows prose claims as unverified in the list and in the gate notes", async () => {
    const repo = project();
    await add(repo, "smaller is used for discounts", "--anchor", "src/max.mjs#smaller");
    const list = await run(repo, ["claims", "list"]);
    assert.match(list.stdout, /"kind":"prose","verified":false/);
    write(repo.root, "src/max.mjs", MAX.replace("a < b ? a : b", "Math.min(a, b)"));
    assert.ok(keys(await claimsItem(repo)).includes("gate.claims.unverified"));
  });

  it("reports a check that kills no mutant as decorative", async () => {
    const repo = project();
    const strong = await add(repo, "larger works", "--anchor", "src/max.mjs#larger", "--check", LARGER_CHECK);
    const weak = await add(repo, "max.mjs exists", "--anchor", "src/max.mjs#larger", "--check", ALWAYS);
    write(repo.root, "src/max.mjs", MAX.replace("a > b ? a : b", "b < a ? a : b"));
    const entry = await claimsItem(repo);
    assert.equal(field(entry, "status"), "passed", JSON.stringify(entry));
    const decorative = notes(entry)
      .filter((item) => field(item, "key") === "gate.claims.decorative")
      .map((item) => field(item, "params", "id"));
    assert.deepEqual(decorative, [weak]);
    assert.ok(!decorative.includes(strong));
  });

  it("runs only checks anchored to touched files", async () => {
    const repo = project();
    await add(repo, "other is broken on purpose", "--anchor", "src/other.mjs", "--check", `node -e "process.exit(1)"`);
    write(repo.root, "src/max.mjs", MAX.replace("a > b ? a : b", "Math.max(a, b)"));
    const entry = await claimsItem(repo);
    assert.equal(field(entry, "status"), "passed");
    assert.ok(!keys(entry).includes("gate.claims.failed"));
  });

  it("lists checked conventions in the onboard block and leaves prose out", async () => {
    const repo = project();
    await add(repo, "larger returns the bigger number", "--anchor", "src/max.mjs#larger", "--check", ALWAYS);
    await add(repo, "smaller is used for discounts", "--anchor", "src/max.mjs#smaller");
    await run(repo, ["onboard"]);
    const agents = readFileSync(join(repo.root, "AGENTS.md"), "utf8");
    assert.match(agents, /larger returns the bigger number/);
    assert.doesNotMatch(agents, /smaller is used for discounts/);
  });
});
