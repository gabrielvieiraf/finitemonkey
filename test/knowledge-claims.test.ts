import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { appendEvidence } from "../src/evidence/ledger.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const TOTALS = [
  "export function total(items: number[]): number {",
  "  return Math.round(items.reduce((a, b) => a + b, 0) * 100) / 100;",
  "}",
  "",
  "export function tax(value: number): number {",
  "  return value * 0.1;",
  "}",
  "",
].join("\n");

const setup = (extra: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({ "src/totals.ts": TOTALS, ...extra });
  repos.push(repo);
  return repo;
};

const run = (repo: Repo, args: readonly string[]) => cliJson(args, { cwd: repo.root, runtime: repoRuntime() });

const add = async (repo: Repo, text: string, ...args: readonly string[]): Promise<string> => {
  const added = await run(repo, ["claims", "add", text, ...args]);
  assert.equal(added.code, 0, added.stdout);
  return String(field(added.body, "data", "id"));
};

const statusOf = async (repo: Repo, id: string): Promise<unknown> => {
  const list = await run(repo, ["claims", "list"]);
  const claims = field(list.body, "data", "claims");
  return Array.isArray(claims)
    ? field(
        claims.find((item) => field(item, "id") === id),
        "status",
      )
    : undefined;
};

describe("anchored claims", () => {
  it("goes stale when the anchored function changes and not when a sibling changes", async () => {
    const repo = setup();
    const id = await add(repo, "Totals round to cents", "--anchor", "src/totals.ts#total");
    repo.write("src/totals.ts", TOTALS.replace("value * 0.1", "value * 0.2"));
    assert.equal(await statusOf(repo, id), "valid");
    repo.write("src/totals.ts", TOTALS.replace("* 100) / 100", "* 1000) / 1000"));
    assert.equal(await statusOf(repo, id), "stale");
  });

  it("keeps a claim valid after a pure move and rename", async () => {
    const repo = setup();
    const id = await add(repo, "Totals round to cents", "--anchor", "src/totals.ts#total");
    repo.git("mv", "src/totals.ts", "src/money.ts");
    assert.equal(await statusOf(repo, id), "valid");
  });

  it("prints the origin chain down to the evidence and the prompt", async () => {
    const repo = setup({
      ".finitemonkey/prompts.jsonl": `${JSON.stringify({ at: "2026-10-01T09:00:00.000Z", session: "s1", text: "round totals to cents" })}\n`,
    });
    appendEvidence(repoRuntime(), fmPaths(repo.root).evidence("t1"), [
      {
        schema: "finitemonkey/evidence@1",
        task: "t1",
        check: "tests",
        kind: "tests",
        status: "passed",
        treeHash: "wabc",
        at: "2026-10-01T10:00:00.000Z",
        notes: [],
      },
    ]);
    const id = await add(
      repo,
      "Totals round to cents",
      "--anchor",
      "src/totals.ts#total",
      "--evidence",
      "t1:1",
      "--prompt",
      "2026-10-01T09:00:00.000Z",
    );
    const why = await run(repo, ["claims", "why", id]);
    assert.match(why.stdout, /tests passed at tree wabc/);
    assert.match(why.stdout, /round totals to cents/);
  });

  it("reproduces what was valid at an earlier commit", async () => {
    const repo = setup();
    const first = repo.git("rev-parse", "HEAD").trim();
    const id = await add(repo, "Totals round to cents", "--anchor", "src/totals.ts#total");
    repo.write("src/totals.ts", TOTALS.replace("* 100) / 100", "* 1000) / 1000"));
    repo.commit("change rounding");
    const second = repo.git("rev-parse", "HEAD").trim();
    const statusAt = async (commit: string): Promise<unknown> => {
      const asof = await run(repo, ["claims", "asof", commit]);
      const claims = field(asof.body, "data", "claims");
      return Array.isArray(claims)
        ? field(
            claims.find((item) => field(item, "id") === id),
            "status",
          )
        : undefined;
    };
    assert.equal(await statusAt(first), "valid");
    assert.equal(await statusAt(second), "stale");
  });

  it("never injects a stale claim into the context", async () => {
    const repo = setup({ ".finitemonkey/policy.yml": policyWith({ "knowledge-claims": "active" }) });
    await add(repo, "Totals round to cents", "--anchor", "src/totals.ts#total");
    await add(repo, "Tax is ten percent", "--anchor", "src/totals.ts#tax");
    repo.write("src/totals.ts", TOTALS.replace("value * 0.1", "value * 0.2"));
    const started = await fireHook(repo, "SessionStart", { source: "startup" });
    assert.match(contextOf(started), /Totals round to cents/);
    assert.doesNotMatch(contextOf(started), /Tax is ten percent/);
  });

  it("records the claim as stale when an edit changes its anchor", async () => {
    const repo = setup();
    await add(repo, "Tax is ten percent", "--anchor", "src/totals.ts#tax");
    repo.write("src/totals.ts", TOTALS.replace("value * 0.1", "value * 0.2"));
    await fireHook(repo, "PostToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: `${repo.root}/src/totals.ts`, old_string: "0.1", new_string: "0.2" },
      tool_response: {},
    });
    assert.match(repo.read(".finitemonkey/claims.jsonl"), /"event":"stale"/);
  });
});
