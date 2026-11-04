import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { git, type TempRepo, tempRepo, write } from "./git-support.js";
import { envelope, type FakeClaude, MALFORMED, providerJson } from "./provider-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, execResult, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const OWN = /^(\.git|\.fm)(\/|$)/;

const snapshot = (root: string): string =>
  JSON.stringify(
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .map((path) => path.replaceAll("\\", "/"))
      .filter((path) => !OWN.test(path) && statSync(join(root, path)).isFile())
      .sort()
      .map((path) => [
        path,
        createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest("hex"),
      ]),
  );

const state = (root: string): readonly string[] => [
  snapshot(root),
  git(root, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).fm"),
  git(root, "worktree", "list", "--porcelain"),
];

interface Seen {
  readonly cwds: string[];
}

const withClaude = (
  fake: FakeClaude,
  seen: Seen,
  onCall: (request: ExecRequest) => void = () => undefined,
): Runtime => {
  const base = repoRuntime();
  return {
    ...base,
    exec: (request) => {
      if (request.command !== "claude") return base.exec(request);
      seen.cwds.push(request.cwd);
      onCall(request);
      return execResult(0, envelope(fake.answer(request), fake.usd));
    },
  };
};

const REFUND_CONTRACT = [
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

const divergenceRepo = (): TempRepo => {
  const repo = tempRepo({ "src/refund.js": 'console.log("not built yet");\n' });
  repos.push(repo);
  write(repo.root, ".fm/policy.yml", "guards:\n  divergence-ask: active\n  model-provider: active\n");
  write(repo.root, ".fm/provider.json", providerJson(["divergence"]));
  trustContract(repo.root, "refund", REFUND_CONTRACT);
  return repo;
};

const withExample = async (repo: TempRepo, runtime: Runtime): Promise<void> => {
  const run = (args: readonly string[]) => cliJson(args, { cwd: repo.root, runtime });
  const example = [
    "--says",
    "a refund of 50",
    "--run",
    "node src/refund.js",
    "--input",
    "50",
    "--expect",
    "refund 50 to card",
  ];
  await run(["task", "examples", "refund", ...example]);
  await run(["task", "examples", "refund", "--approve", "E1"]);
};

const reading = (request: ExecRequest): void => {
  const index = Number(field(JSON.parse(request.input ?? "{}"), "reading"));
  write(request.cwd, "src/refund.js", refund(index === 2 ? "error: negative amount" : "nothing to refund"));
};

const MAX = (body: string): string => `module.exports.max = ${body};\n`;
const BLIND_CONTRACT = [
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

const test = (name: string, file: string, body: string) => ({
  name,
  file,
  content: `const { max } = require("../src/max.js"); ${body}\n`,
  run: `node ${file}`,
});

const TESTS = {
  tests: [
    test("larger first", "blind/larger.test.js", "if (max(3, 1) !== 3) process.exit(1);"),
    test("exists", "blind/exists.test.js", 'if (typeof max !== "function") process.exit(1);'),
  ],
};

const blindRepo = (): TempRepo => {
  const repo = tempRepo({ "src/max.js": MAX("() => 0") });
  repos.push(repo);
  write(repo.root, ".fm/policy.yml", "guards:\n  blind-tests: active\n  model-provider: active\n");
  write(repo.root, ".fm/provider.json", providerJson(["blind-writer"]));
  trustContract(
    repo.root,
    "max",
    BLIND_CONTRACT.replace("id: max", `id: max\nbase: ${git(repo.root, "rev-parse", "HEAD")}`),
  );
  write(repo.root, "src/max.js", MAX("(a, b) => (a < b ? a : b)"));
  return repo;
};

const blindItem = async (repo: TempRepo, runtime: Runtime): Promise<unknown> => {
  const gate = await cliJson(["gate"], { cwd: repo.root, runtime });
  const items = field(gate.body, "data", "items");
  const found: unknown = Array.isArray(items)
    ? items.find((item: unknown) => field(item, "id") === "blind-tests")
    : undefined;
  return found ?? gate.stdout;
};

describe("generators that need code run in a throwaway worktree", () => {
  it("divergence and blind-test calls leave the working tree byte-identical", async () => {
    const repo = divergenceRepo();
    const seen: Seen = { cwds: [] };
    const runtime = withClaude(
      { answer: () => JSON.stringify({ summary: "one reading", inputs: ["-5"] }) },
      seen,
      reading,
    );
    await withExample(repo, runtime);
    const before = state(repo.root);
    const asked = await cliJson(["task", "diverge", "refund"], { cwd: repo.root, runtime });
    assert.equal(field(asked.body, "data", "outcome"), "question", asked.stdout);
    assert.deepEqual(state(repo.root), before);
    assert.equal(seen.cwds.length, 3);
    for (const cwd of seen.cwds) assert.notEqual(cwd, repo.root);

    const blind = blindRepo();
    const blindSeen: Seen = { cwds: [] };
    const blindRuntime = withClaude({ answer: () => JSON.stringify(TESTS) }, blindSeen);
    const pending = await blindItem(blind, blindRuntime);
    assert.equal(field(pending, "status"), "passed");
    assert.deepEqual(blindSeen.cwds, [], "the gate never calls the model itself");
    const blindBefore = state(blind.root);
    const written = await cliJson(["provider", "run", "blind-writer"], { cwd: blind.root, runtime: blindRuntime });
    assert.equal(field(written.body, "data", "outcome"), "written", written.stdout);
    assert.deepEqual(state(blind.root), blindBefore);
    assert.equal(blindSeen.cwds.length, 1);
    assert.notEqual(blindSeen.cwds[0], blind.root);
    assert.equal(field(await blindItem(blind, blindRuntime), "status"), "failed", "the tests it wrote catch the bug");
  });

  it("blind-writer: malformed output or tests that always pass change no gate verdict", async () => {
    const always = { tests: [test("always", "blind/always.test.js", "process.exit(0);")] };
    for (const fake of [MALFORMED, { answer: () => JSON.stringify(always) }]) {
      const repo = blindRepo();
      const runtime = withClaude(fake, { cwds: [] });
      await cliJson(["provider", "run", "blind-writer"], { cwd: repo.root, runtime });
      const item = await blindItem(repo, runtime);
      assert.equal(field(item, "status"), "passed", JSON.stringify(item));
    }
  });

  it("divergence: malformed output stores no example and asks nothing", async () => {
    const repo = divergenceRepo();
    const seen: Seen = { cwds: [] };
    const runtime = withClaude(MALFORMED, seen);
    await withExample(repo, runtime);
    const before = state(repo.root);
    const asked = await cliJson(["task", "diverge", "refund"], { cwd: repo.root, runtime });
    assert.equal(field(asked.body, "data", "reason"), "generator_failed", asked.stdout);
    assert.equal(seen.cwds.length, 3);
    assert.deepEqual(state(repo.root), before);
  });
});
