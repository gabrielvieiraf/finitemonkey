import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { nodeRuntime } from "../src/core/node-runtime.js";
import { type DriftFinding, gitDriftInput, instructionDrift, pathShaped } from "../src/instructions/drift.js";
import { git, type TempRepo, tempRepo } from "./git-support.js";
import { cliJson, field } from "./support.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const AGENTS = [
  "# Rules",
  "",
  "Run `npm run release:old` before tagging.",
  "Use `pnpm install` to set up the project.",
  "Never use `lodash` in new code.",
  "The entry point is `src/gone.ts` and it calls `oldHelper()`.",
  "Near misses: `true/false`, `and/or`, `https://example.com/a/b.ts`, `~/.claude/settings.json`,",
  "`src/**/*.ts`, `$HOME/bin`, `node.js`, `e.g.`, `<dir>/x`, `v1.2`, `README.md`, `src/app.ts`, `parseConfig`.",
  "",
].join("\n");

const project = (): TempRepo => {
  const repo = tempRepo({
    "AGENTS.md": AGENTS,
    "README.md": "hello\n",
    "package.json": `${JSON.stringify({ scripts: { test: "node -e 0" }, dependencies: { lodash: "4" } })}\n`,
    "package-lock.json": "{}\n",
    "src/app.ts": "export const parseConfig = (): number => 1;\n",
    ".finitemonkey/rules.yml": "rules:\n  - id: no-console\n    text: no console.log\n",
  });
  repos.push(repo);
  return repo;
};

const violations = (rule: string, count: number): string =>
  Array.from({ length: count }, (_, index) =>
    JSON.stringify({ at: `2026-10-0${String(index + 1)}T00:00:00Z`, session: "s", rule, source: "guard", detail: "" }),
  ).join("\n");

const drift = (repo: TempRepo, proposer?: Parameters<typeof gitDriftInput>[2]["proposer"]): readonly DriftFinding[] =>
  instructionDrift(
    gitDriftInput(nodeRuntime(), repo.root, {
      conflicts: [],
      violationLimit: 3,
      ...(proposer === undefined ? {} : { proposer }),
    }),
  );

const refs = (findings: readonly DriftFinding[], kind: DriftFinding["kind"]): readonly string[] =>
  findings.flatMap((item) => (item.kind === kind && "ref" in item ? [item.ref] : []));

describe("instruction drift", () => {
  it("reports a reference to a deleted script with file, line and the commit that wrote it", () => {
    const repo = project();
    const head = git(repo.root, "rev-parse", "HEAD");
    const found = drift(repo).find((item) => item.kind === "missing_script");
    assert.deepEqual(found, {
      kind: "missing_script",
      at: { file: "AGENTS.md", line: 3, commit: head },
      ref: "npm run release:old",
    });
  });

  it("reports a pnpm instruction when the lockfile is npm and a forbidden library in the manifest", () => {
    const findings = drift(project());
    assert.deepEqual(
      findings.flatMap((item) => (item.kind === "wrong_manager" ? [[item.ref, item.lockfile, item.at.line]] : [])),
      [["pnpm", "package-lock.json", 4]],
    );
    assert.deepEqual(refs(findings, "forbidden_dependency"), ["lodash"]);
  });

  it("reports only path- or symbol-shaped tokens absent from the whole tree", () => {
    const findings = drift(project());
    assert.deepEqual(refs(findings, "missing_path"), ["src/gone.ts"]);
    assert.deepEqual(refs(findings, "missing_symbol"), ["oldHelper()"]);
    for (const near of ["true/false", "and/or", "https://example.com/a/b.ts", "~/.claude/settings.json", "src/**/*.ts"])
      assert.equal(pathShaped(near), false, near);
    for (const near of ["$HOME/bin", "node.js", "e.g.", "<dir>/x", "v1.2"]) assert.equal(pathShaped(near), false, near);
  });

  it("labels contradictions from a model as proposals and never as findings of its own", () => {
    const findings = drift(project(), () => [
      { first: { file: "AGENTS.md", line: 3 }, second: { file: "AGENTS.md", line: 5 } },
    ]);
    const contradiction = findings.find((item) => item.kind === "contradiction");
    assert.equal(contradiction?.kind === "contradiction" ? contradiction.proposal : undefined, true);
  });

  it("names a rule that keeps being violated", () => {
    const repo = project();
    writeFileSync(join(repo.root, ".finitemonkey/rule-violations.jsonl"), `${violations("no-console", 3)}\n`);
    const found = drift(repo).find((item) => item.kind === "violated_rule");
    assert.equal(
      found?.kind === "violated_rule" ? `${found.ref}:${String(found.count)}:${String(found.at.line)}` : "",
      "no-console:3:2",
    );
  });

  it("shows the findings in instructions and fails with --strict", async () => {
    const repo = project();
    const run = await cliJson(["instructions"], { cwd: repo.root, runtime: nodeRuntime() });
    assert.equal(run.code, 0);
    assert.match(JSON.stringify(field(run.body, "data", "drift")), /release:old/);
    const strict = await cliJson(["instructions", "--strict"], { cwd: repo.root, runtime: nodeRuntime() });
    assert.notEqual(strict.code, 0);
  });
});
