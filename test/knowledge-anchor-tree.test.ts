import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { anchorAt, anchorState } from "../src/knowledge/anchor.js";
import { NO_SYNTAX, projectSyntax } from "../src/knowledge/syntax.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, execResult, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const CART = [
  "export function outer(items: number[]): number {",
  "  function inner(value: number): number {",
  "    return Math.round(value * 100) / 100;",
  "  }",
  "  const other = (value: number): number => value + 1;",
  "  return inner(other(items.length));",
  "}",
  "",
].join("\n");

const PY = [
  "class Cart:",
  "    def inner(self, value):",
  "        return round(value, 2)",
  "",
  "    def other(self, value):",
  "        return value + 1",
  "",
].join("\n");

const PY_SPANS = JSON.stringify({ Cart: [1, 6], "Cart.inner": [2, 3], "Cart.other": [5, 6] });

const ROOT = toAbsolutePath(process.cwd());

const pythonRuntime = (output: string | undefined, calls: ExecRequest[] = []): Pick<Runtime, "exec"> => ({
  exec: (request) => {
    calls.push(request);
    return output === undefined
      ? { found: false, exitCode: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 }
      : execResult(0, output);
  },
});

describe("anchors by syntax tree", () => {
  it("keeps a TypeScript claim on a nested function valid when a sibling changes", () => {
    const syntax = projectSyntax(pythonRuntime(undefined), ROOT);
    const anchor = anchorAt(CART, "src/cart.ts", "outer.inner", syntax);
    assert.equal(anchor?.parser, "ts");
    assert.equal(anchorState(anchor, CART.replace("value + 1", "value + 2"), syntax), "same");
    assert.equal(anchorState(anchor, CART.replace("* 100) / 100", "* 10) / 10"), syntax), "changed");
    assert.equal(anchorState(anchor, CART.replace(/function inner/, "function renamed"), syntax), "missing");
  });

  it("finds a nested name by its last segment when it is unique", () => {
    const syntax = projectSyntax(pythonRuntime(undefined), ROOT);
    assert.equal(anchorAt(CART, "src/cart.ts", "inner", syntax)?.parser, "ts");
    assert.equal(anchorAt(CART, "src/cart.ts", "inner", NO_SYNTAX), undefined);
  });

  it("keeps a Python claim on a method valid when a sibling changes, reading spans from python3 ast", () => {
    const calls: ExecRequest[] = [];
    const syntax = projectSyntax(pythonRuntime(PY_SPANS, calls), ROOT);
    const anchor = anchorAt(PY, "app/cart.py", "Cart.inner", syntax);
    assert.equal(anchor?.parser, "python");
    assert.equal(calls[0]?.command, "python3");
    assert.equal(calls[0].input, PY);
    assert.equal(anchorState(anchor, PY.replace("value + 1", "value + 2"), syntax), "same");
    assert.equal(anchorState(anchor, PY.replace("round(value, 2)", "round(value, 3)"), syntax), "changed");
  });

  it("falls back to the top-level body when python3 is missing", () => {
    const syntax = projectSyntax(pythonRuntime(undefined), ROOT);
    const anchor = anchorAt(PY, "app/cart.py", "Cart", syntax);
    assert.equal(anchor?.parser, undefined);
    assert.equal(anchor?.mode, "symbol");
    assert.equal(anchorAt(PY, "app/cart.py", "Cart.inner", syntax), undefined);
  });

  it("reports a tree anchor as missing when its parser is not available, never as same", () => {
    const anchor = anchorAt(PY, "app/cart.py", "Cart.inner", projectSyntax(pythonRuntime(PY_SPANS), ROOT));
    assert.ok(anchor !== undefined);
    assert.equal(anchorState(anchor, PY, projectSyntax(pythonRuntime(undefined), ROOT)), "missing");
  });
});

const TOTALS = "export function total(items: number[]): number {\n  return items.length;\n}\n";

const noGit = (): Runtime => {
  const base = repoRuntime();
  return {
    ...base,
    git: () => ({ found: false, ok: false, stdout: "" }),
    exec: (request) =>
      request.command === "git"
        ? { found: false, exitCode: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 }
        : base.exec(request),
  };
};

const edited = (repo: Repo, tool: string, file: string) =>
  fireHook(
    repo,
    "PostToolUse",
    { tool_name: tool, tool_input: { file_path: join(repo.root, ...file.split("/")) } },
    noGit(),
  );

const movedRepo = async (): Promise<{ readonly repo: Repo; readonly id: string }> => {
  const repo = makeRepo({
    "src/totals.ts": TOTALS,
    "src/other.ts": "export const x = 1;\n",
    ".fm/policy.yml": policyWith({ "knowledge-claims": "active" }),
  });
  repos.push(repo);
  const added = await cliJson(["claims", "add", "total counts items", "--anchor", "src/totals.ts#total"], {
    cwd: repo.root,
    runtime: repoRuntime(),
  });
  assert.equal(added.code, 0, added.stdout);
  return { repo, id: String(field(added.body, "data", "id")) };
};

const events = (repo: Repo): string => repo.read(".fm/claims.jsonl");

describe("moves seen in hooks without git", () => {
  it("keeps the claim when the symbol is written to a new file before the old one loses it", async () => {
    const { repo, id } = await movedRepo();
    repo.write("src/money.ts", TOTALS);
    await edited(repo, "Write", "src/money.ts");
    repo.write("src/totals.ts", "export const gone = 0;\n");
    await edited(repo, "Edit", "src/totals.ts");
    assert.doesNotMatch(events(repo), new RegExp(`"event":"stale","id":"${id}"`));
    const started = await fireHook(repo, "SessionStart", { source: "startup" }, noGit());
    assert.match(contextOf(started), /total counts items/);
  });

  it("renews the claim at the new path when the old file loses the symbol first", async () => {
    const { repo, id } = await movedRepo();
    repo.write("src/totals.ts", "export const gone = 0;\n");
    await edited(repo, "Edit", "src/totals.ts");
    assert.match(events(repo), new RegExp(`"event":"stale","id":"${id}"`));
    repo.write("src/money.ts", TOTALS);
    await edited(repo, "Write", "src/money.ts");
    assert.match(events(repo), /"reason":"moved"[^\n]*"path":"src\/money\.ts"/);
    const started = await fireHook(repo, "SessionStart", { source: "startup" }, noGit());
    assert.match(contextOf(started), /total counts items/);
  });

  it("still marks a claim stale when the symbol is gone everywhere", async () => {
    const { repo, id } = await movedRepo();
    repo.write("src/totals.ts", "export const gone = 0;\n");
    await edited(repo, "Edit", "src/totals.ts");
    assert.match(events(repo), new RegExp(`"event":"stale","id":"${id}","recordedAt":"[^"]+","reason":"missing`));
  });
});
