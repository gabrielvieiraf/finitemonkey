import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { gitAt, treeHash } from "../src/gate/git.js";
import { checkBlock, provenanceSources, renderBlock } from "../src/pr/provenance.js";
import { attachProvenance } from "../src/pr/provenance-attach.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli } from "./support.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const CONTRACT =
  "id: billing\ngoal: totals\nsize: S\nscope:\n  paths: [src/]\nacceptance:\n  - id: unit\n    check: command\n    run: npm test\n  - id: lint\n    check: command\n    run: npm run lint\n";

const setup = (): { repo: Repo; tree: string; outside: string } => {
  const repo = makeRepo({ "README.md": "x\n" });
  const outside = mkdtempSync(join(tmpdir(), "fm-body-"));
  cleanups.push(repo.cleanup, () => {
    rmSync(outside, { recursive: true, force: true });
  });
  repo.git("switch", "-q", "-c", "feat/totals");
  repo.write("src/total.ts", "export const total = 1;\n");
  repo.write("src/manual.ts", "export const manual = 2;\n");
  repo.commit("feat: totals");
  const runtime = repoRuntime();
  const tree = treeHash(gitAt(runtime, repo.root)) ?? "";
  const evidence = (check: string, status: string, treeHash: string): string =>
    signedLine(runtime, {
      schema: "finitemonkey/evidence@1",
      task: "billing",
      check,
      kind: "command",
      status,
      treeHash,
      at: "2026-10-01T10:00:00.000Z",
      notes: [],
      command: check === "unit" ? "npm test" : "npm run lint",
      exitCode: status === "passed" ? 0 : 1,
    });
  repo.write(".finitemonkey/tasks/billing.yml", CONTRACT);
  repo.write(".finitemonkey/state.json", JSON.stringify({ schemaVersion: 1, active: "billing", done: [] }));
  repo.write(
    ".finitemonkey/evidence/billing.jsonl",
    `${evidence("unit", "passed", tree)}\n${evidence("lint", "failed", tree)}\n`,
  );
  repo.write(
    ".finitemonkey/signals.jsonl",
    `${JSON.stringify({ kind: "edit", at: "2026-10-01T09:00:00.000Z", session: "s1", turn: 1, file: "src/total.ts", hash: "h", undo: false })}\n`,
  );
  return { repo, tree, outside };
};

describe("provenance block", () => {
  it("lists each passed gate check with its tree hash, and the rest as not verified", () => {
    const { repo, tree } = setup();
    const block = renderBlock(provenanceSources(repoRuntime(), repo.root, ["src/manual.ts", "src/total.ts"]));
    assert.match(block, new RegExp(`- unit: passed at tree \`${tree}\`, \`npm test\`, exit 0`));
    assert.match(block, /### Not verified\n- lint: failed/);
  });

  it("marks files without tool events as unknown, never as the person's", () => {
    const { repo } = setup();
    const block = renderBlock(provenanceSources(repoRuntime(), repo.root, ["src/manual.ts", "src/total.ts"]));
    assert.match(block, /- src\/manual\.ts: unknown/);
    assert.match(block, /- src\/total\.ts: agent edits \(1\)/);
    assert.doesNotMatch(block, /person/i);
  });

  it("carries no co-author trailer and no model or tool name", () => {
    const { repo } = setup();
    const block = renderBlock(provenanceSources(repoRuntime(), repo.root, ["src/total.ts"]));
    assert.doesNotMatch(block, /co-authored-by|generated with|claude|anthropic|gpt|openai|gemini|opus|sonnet|haiku/i);
  });

  it("fails the consistency check when the block is edited by hand", async () => {
    const { repo, outside } = setup();
    const shown = await cli(["pr", "provenance", "--base", "main", "--json"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    const block = (JSON.parse(shown.stdout) as { data: { block: string } }).data.block;
    const intact = join(outside, "intact.md");
    const edited = join(outside, "edited.md");
    writeFileSync(intact, `Summary\n\n${block}\n`);
    writeFileSync(edited, `Summary\n\n${block.replace("lint: failed", "lint: passed")}\n`);
    const ok = await cli(["pr", "provenance", "--base", "main", "--check", intact], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    const bad = await cli(["pr", "provenance", "--base", "main", "--check", edited], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(ok.code, 0);
    assert.notEqual(bad.code, 0);
    assert.equal(checkBlock("no block here", block), "missing");
  });

  it("is stored but not inserted in shadow, and inserted when active", () => {
    const { repo } = setup();
    const shadow = attachProvenance(repoRuntime(), repo.root, "Body\n", ["src/total.ts"]);
    assert.equal(shadow, "Body\n");
    assert.match(repo.read(".finitemonkey/cache/pr-provenance.md"), /## Provenance/);
    repo.write(".finitemonkey/policy.yml", "guards:\n  pr-provenance: active\n");
    assert.match(
      attachProvenance(repoRuntime(), repo.root, "Body\n", ["src/total.ts"]),
      /Body\n\n<!-- finitemonkey:provenance sha256=/,
    );
  });
});
