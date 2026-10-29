import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, describe, it } from "node:test";

import { selfGuard } from "../src/guards/self/hook.js";
import { approvedExamples } from "../src/task/examples.js";
import { fmPaths } from "../src/task/paths.js";
import { bash, hook, tempDir, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const CONTRACT = [
  "id: refund",
  "goal: refunds go back to the card",
  "size: M",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node src/refund.js --version",
  "",
].join("\n");

const refund = (negative: string): string =>
  [
    'const amount = Number(require("node:fs").readFileSync(0, "utf8").trim());',
    `if (amount < 0) { console.log(${JSON.stringify(negative)}); process.exit(0); }`,
    'console.log(amount > 0 ? `refund ${amount} to card` : "nothing to refund");',
    "",
  ].join("\n");

const OLD = 'console.log("not built yet");\n';

const repos: TempRepo[] = [];
const dirs: string[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const candidate = (negative: string): string => {
  const dir = tempDir("fm-candidate-");
  dirs.push(dir);
  write(dir, "src/refund.js", refund(negative));
  return dir;
};

const project = (readings: readonly string[], inputs: readonly unknown[], mode = "active"): TempRepo => {
  const repo = tempRepo({ "src/refund.js": OLD });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", `guards:\n  divergence-ask: ${mode}\n`);
  const answer = JSON.stringify({
    readings: readings.map((dir, index) => ({ dir, summary: `reading ${String(index)}` })),
    inputs,
  });
  write(repo.root, "generator.mjs", `process.stdout.write(${JSON.stringify(answer)});\n`);
  write(repo.root, ".finitemonkey/config.yml", "divergence:\n  generator: node generator.mjs\n");
  trustContract(repo.root, "refund", CONTRACT);
  return repo;
};

const run = (repo: TempRepo, args: readonly string[]): ReturnType<typeof cliJson> =>
  cliJson(args, { cwd: repo.root, runtime: repoRuntime() });

const withExample = async (repo: TempRepo): Promise<void> => {
  await run(repo, [
    "task",
    "examples",
    "refund",
    "--says",
    "a refund of 50 returns to the card",
    "--run",
    "node src/refund.js",
    "--input",
    "50",
    "--expect",
    "refund 50 to card",
  ]);
  await run(repo, ["task", "examples", "refund", "--approve", "E1"]);
};

describe("divergence question", () => {
  it("asks one question with the input and both outputs when candidates disagree", async () => {
    const repo = project([candidate("nothing to refund"), candidate("error: negative amount")], ["-5"]);
    await withExample(repo);
    const asked = await run(repo, ["task", "diverge", "refund"]);
    assert.equal(field(asked.body, "data", "outcome"), "question", asked.stdout);
    assert.equal(field(asked.body, "data", "question", "input"), "-5");
    const options = field(asked.body, "data", "question", "options");
    assert.ok(Array.isArray(options));
    assert.deepEqual(
      options.map((option: unknown) => field(option, "output")),
      ["nothing to refund", "error: negative amount"],
    );
  });

  it("asks nothing when the readings agree", async () => {
    const repo = project([candidate("nothing to refund"), candidate("nothing to refund")], ["-5", "7"]);
    await withExample(repo);
    const asked = await run(repo, ["task", "diverge", "refund"]);
    assert.equal(field(asked.body, "data", "outcome"), "agree");
    assert.equal(field(asked.body, "data", "question"), undefined);
  });

  it("reports that no change is needed when the current code already passes", async () => {
    const repo = project([candidate("a"), candidate("b")], ["-5"]);
    write(repo.root, "src/refund.js", refund("nothing to refund"));
    await withExample(repo);
    const asked = await run(repo, ["task", "diverge", "refund"]);
    assert.equal(field(asked.body, "data", "outcome"), "no_change");
  });

  it("stores the chosen answer as an approved example, and only the person chooses", async () => {
    const repo = project([candidate("nothing to refund"), candidate("error: negative amount")], ["-5"]);
    await withExample(repo);
    await run(repo, ["task", "diverge", "refund"]);
    const denied = await hook(selfGuard, "PreToolUse", repo.root, bash("fm task diverge refund --choose B"));
    assert.equal(denied.kind, "block");
    const chosen = await run(repo, ["task", "diverge", "refund", "--choose", "B"]);
    assert.equal(chosen.code, 0, chosen.stdout);
    const approved = approvedExamples(repoRuntime(), fmPaths(repo.root), "refund").examples;
    assert.deepEqual(
      approved.map((example) => [example.input, example.expect]),
      [
        ["50", "refund 50 to card"],
        ["-5", "error: negative amount"],
      ],
    );
  });

  it("skips small contracts and routes technical questions away from beginners", async () => {
    const repo = project(
      [candidate("nothing to refund"), candidate("error: negative amount")],
      [{ input: "-5", topic: "technical", domain: "backend" }],
    );
    write(
      repo.root,
      ".finitemonkey/perfil.yml",
      "domains:\n  backend:\n    tool: 10\n    knowledge: 10\nquick_start: done\n",
    );
    await withExample(repo);
    const asked = await run(repo, ["task", "diverge", "refund"]);
    assert.equal(field(asked.body, "data", "outcome"), "agree");
    const small = tempRepo({ "x.js": "" });
    repos.push(small);
    trustContract(small.root, "tiny", CONTRACT.replace("id: refund", "id: tiny").replace("size: M", "size: S"));
    const skipped = await run(small, ["task", "diverge", "tiny"]);
    assert.equal(field(skipped.body, "data", "reason"), "small");
  });
});
