import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { agentFiles } from "../src/conceitos/credit.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { runsOf } from "../src/pr/hunks.js";
import { provenanceSources, renderBlock } from "../src/pr/provenance.js";
import { verifyBlockText } from "../src/pr/provenance-verify.js";
import { lineHash } from "../src/signals/line-hashes.js";
import { readEntries, signalFiles } from "../src/signals/store.js";
import { fmPaths } from "../src/task/paths.js";
import { denied, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli } from "./support.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const repoWith = (files: Readonly<Record<string, string>>): Repo => {
  const repo = makeRepo({ ".finitemonkey/.gitkeep": "", ...files });
  cleanups.push(repo.cleanup);
  return repo;
};

const RECORD = "---\nstatus: proposed\n---\n# Queue\n\n## Status\n\nproposed\n";
const SED = "sed -i 's/status: proposed/status: accepted/' docs/plan/02-decision-queue.md";

const bash = (repo: Repo, command: string, id: string) => ({
  pre: () => fireHook(repo, "PreToolUse", { tool_name: "Bash", tool_use_id: id, tool_input: { command } }),
  post: () => fireHook(repo, "PostToolUse", { tool_name: "Bash", tool_use_id: id, tool_input: { command } }),
});

const logOf = (repo: Repo): string => {
  try {
    return repo.read(".finitemonkey/log.jsonl");
  } catch {
    return "";
  }
};

describe("bash writes: the decision hold", () => {
  it("holds sed -i on a decision record at the default level and only logs it at level light", async () => {
    const repo = repoWith({ "docs/plan/02-decision-queue.md": RECORD });
    assert.equal(denied(await bash(repo, SED, "t0").pre()), true);
    repo.write(".finitemonkey/policy.yml", "level: light\n");
    const shadow = await bash(repo, SED, "t1").pre();
    assert.equal(denied(shadow), false);
    assert.match(logOf(repo), /"event":"guard_shadow","guard":"bash-writes"/);
    repo.write(".finitemonkey/policy.yml", `level: light\n${policyWith({ "bash-writes": "active" })}`);
    assert.equal(denied(await bash(repo, SED, "t2").pre()), true);
  });

  it("holds redirects, tee and interpreter one-liners, and lets reads and other files through", async () => {
    const repo = repoWith({
      "docs/plan/02-decision-queue.md": RECORD,
      ".finitemonkey/policy.yml": policyWith({ "bash-writes": "active" }),
    });
    const held = [
      "echo 'status: accepted' >> docs/plan/02-decision-queue.md",
      "printf x | tee docs/plan/02-decision-queue.md",
      "perl -pi -e 's/proposed/accepted/' docs/plan/02-decision-queue.md",
      `node -e "require('fs').writeFileSync('docs/plan/02-decision-queue.md', 'x')"`,
    ];
    for (const command of held) assert.equal(denied(await bash(repo, command, command).pre()), true, command);
    const passed = [
      "cat docs/plan/02-decision-queue.md",
      "wc -l < docs/plan/02-decision-queue.md",
      "sed -i 's/a/b/' src/a.ts",
      "echo x > docs/plan/01-goals.md",
    ];
    for (const command of passed) assert.equal(denied(await bash(repo, command, command).pre()), false, command);
  });
});

describe("bash writes: attribution", () => {
  it("records a file changed through Bash as agent-written in concept credit and PR provenance", async () => {
    const repo = repoWith({ "src/a.ts": "export const a = 1;\n" });
    repo.git("switch", "-q", "-c", "feat/a");
    const command = "sed -i 's/1/2/' src/a.ts";
    const call = bash(repo, command, "w1");
    await call.pre();
    repo.write("src/a.ts", "export const a = 2;\n");
    await call.post();
    const paths = fmPaths(repo.root);
    const runtime = repoRuntime();
    const writes = readEntries(runtime, signalFiles(paths)).flatMap((entry) =>
      entry.kind === "bash_write" ? [[entry.file, entry.tool]] : [],
    );
    assert.deepEqual(writes, [["src/a.ts", "Bash"]]);
    assert.equal(agentFiles(runtime, paths).has("src/a.ts"), true);
    repo.commit("feat: a");
    const block = renderBlock(provenanceSources(runtime, repo.root, ["src/a.ts"], "main"));
    assert.match(block, /- src\/a\.ts: agent edits \(1\), lines 1 agent/);
  });

  it("records nothing for a Bash call that changes no file", async () => {
    const repo = repoWith({ "src/a.ts": "export const a = 1;\n" });
    const call = bash(repo, "ls", "r1");
    await call.pre();
    await call.post();
    const entries = readEntries(repoRuntime(), signalFiles(fmPaths(repo.root)));
    assert.equal(
      entries.some((entry) => entry.kind === "bash_write"),
      false,
    );
  });

  it("shows an agent hunk and a person hunk of the same file in the block", async () => {
    const lines = Array.from({ length: 12 }, (_, index) => `export const v${String(index)} = ${String(index)};`);
    const repo = repoWith({ "src/b.ts": `${lines.join("\n")}\n` });
    repo.git("switch", "-q", "-c", "feat/b");
    const call = bash(repo, "python3 -c 'edit()' src/b.ts", "w2");
    await call.pre();
    const agent = [lines[0], "export const agent = 1;", ...lines.slice(1)];
    repo.write("src/b.ts", `${agent.join("\n")}\n`);
    await call.post();
    repo.write("src/b.ts", `${[...agent, "export const person = 2;"].join("\n")}\n`);
    repo.commit("feat: b");
    const block = renderBlock(provenanceSources(repoRuntime(), repo.root, ["src/b.ts"], "main"));
    assert.match(block, /- src\/b\.ts: agent edits \(1\), lines 2 agent, 14 person/);
  });

  it("credits an Edit hunk to the agent and a later hand edit to the person", async () => {
    const repo = repoWith({ "src/d.ts": "export const d = 1;\nexport const e = 2;\n" });
    repo.git("switch", "-q", "-c", "feat/d");
    repo.write("src/d.ts", "export const d = 10;\nexport const e = 2;\n");
    await fireHook(repo, "PostToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: `${repo.root}/src/d.ts`, old_string: "d = 1;", new_string: "d = 10;" },
      tool_response: { success: true },
    });
    repo.write("src/d.ts", "export const d = 10;\nexport const e = 20;\n");
    repo.commit("feat: d");
    const block = renderBlock(provenanceSources(repoRuntime(), repo.root, ["src/d.ts"], "main"));
    assert.match(block, /- src\/d\.ts: agent edits \(1\), lines 1 agent, 2 person/);
  });

  it("keeps a file with no agent event as unknown, never as the person's", () => {
    const repo = repoWith({ "src/c.ts": "export const c = 1;\n" });
    repo.git("switch", "-q", "-c", "feat/c");
    repo.write("src/c.ts", "export const c = 2;\n");
    repo.commit("feat: c");
    const block = renderBlock(provenanceSources(repoRuntime(), repo.root, ["src/c.ts"], "main"));
    assert.match(block, /- src\/c\.ts: unknown/);
    assert.doesNotMatch(block, /person/);
  });

  it("splits added lines into runs by origin, with blank lines joining their neighbours", () => {
    const added = ["const a = 1;", "", "const b = 2;", "const p = 3;"].map((text, index) => ({
      path: "x.ts",
      line: index + 5,
      text,
    }));
    const agent = new Set([lineHash("const a = 1;"), lineHash("const b = 2;")]);
    assert.deepEqual(runsOf(added, agent), [
      { start: 5, end: 7, origin: "agent" },
      { start: 8, end: 8, origin: "person" },
    ]);
  });
});

describe("provenance block: the CI step", () => {
  const outside = mkdtempSync(join(tmpdir(), "fm-event-"));
  cleanups.push(() => {
    rmSync(outside, { recursive: true, force: true });
  });

  const branchWithBlock = (): { repo: Repo; block: string } => {
    const repo = repoWith({ "src/a.ts": "export const a = 1;\n" });
    repo.git("switch", "-q", "-c", "feat/a");
    repo.write("src/a.ts", "export const a = 2;\n");
    repo.commit("feat: a");
    return { repo, block: renderBlock(provenanceSources(repoRuntime(), repo.root, ["src/a.ts"], "main")) };
  };

  const ciGate = (repo: Repo, body: string, name: string) => {
    const event = join(outside, `${name}.json`);
    writeFileSync(event, JSON.stringify({ pull_request: { title: "feat: a", body } }));
    return cli(["ci", "gate", "--base", "main"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: { GITHUB_EVENT_PATH: toAbsolutePath(event) },
    });
  };

  it("passes an untouched block and fails a hand-edited one, without the local ledger", async () => {
    const { repo, block } = branchWithBlock();
    repo.remove(".finitemonkey");
    const intact = await ciGate(repo, `Summary\r\n\r\n${block.replace(/\n/g, "\r\n")}\r\n`, "intact");
    assert.equal(intact.code, 0, intact.stdout);
    const edited = await ciGate(repo, `Summary\n\n${block.replace("unknown", "agent edits (3)")}\n`, "edited");
    assert.equal(edited.code, 1);
    assert.match(edited.stdout, /FAIL provenance/);
  });

  it("passes a body with no block and fails a block whose header was removed", async () => {
    const { repo, block } = branchWithBlock();
    assert.equal((await ciGate(repo, "Summary only.", "none")).code, 0);
    const headless = block.split("\n").slice(1).join("\n");
    assert.equal(verifyBlockText(headless), "edited");
    assert.equal(verifyBlockText(block.replace(/ text=[0-9a-f]+/, "")), "edited");
    assert.equal(verifyBlockText(`x\n${block}\ny`), "match");
  });
});
