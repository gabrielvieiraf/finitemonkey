import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { agentMarkdown, FORBIDDEN_TOOLS, RESEARCHER, REVIEWER, VERIFIER } from "../src/review/agents.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { BUNDLE, cliJson, fakeRuntime, field, reasonText, ROOT, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const frontmatter = (text: string): Readonly<Record<string, string>> => {
  const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  return Object.fromEntries(
    head.split("\n").flatMap((line) => {
      const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
      return match === null ? [] : [[match[1] ?? "", match[2] ?? ""]];
    }),
  );
};

const listOf = (value: string | undefined): readonly string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

const plugin = (name: string): string => readFileSync(join(ROOT, "plugin", "agents", `${name}.md`), "utf8");

const guard = async (agentType: string, tool: string) => {
  const runtime = fakeRuntime();
  const cwd = toAbsolutePath("/home/ana/project");
  return runHook("PreToolUse", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        cwd,
        agent_id: "a1",
        agent_type: agentType,
        tool_name: tool,
        tool_input: { file_path: `${cwd}/src/a.ts`, content: "x", prompt: "x" },
      }),
    ),
    deadlineMs: 2000,
    handlers: DEFAULT_HANDLERS,
    cwd,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  });
};

describe("reviewer, verifier and researcher agents cannot edit files or spawn agents", () => {
  for (const spec of [REVIEWER, VERIFIER, RESEARCHER]) {
    it(`${spec.name}: the plugin file is generated from the spec, with no edit or agent tool`, () => {
      const text = plugin(spec.name);
      assert.equal(text, agentMarkdown(spec));
      const head = frontmatter(text);
      const tools = listOf(head["tools"]);
      for (const tool of FORBIDDEN_TOOLS) {
        assert.ok(!tools.includes(tool), `${spec.name} has ${tool}`);
        assert.ok(listOf(head["disallowedTools"]).includes(tool), `${spec.name} does not deny ${tool}`);
      }
      assert.equal(head["effort"], "high");
      assert.match(head["model"] ?? "", /^(opus|sonnet)$/);
      assert.match(head["maxTurns"] ?? "", /^\d+$/);
      assert.equal(head["memory"], undefined);
      assert.equal(head["skills"], undefined);
    });

    for (const tool of ["Edit", "Write", "NotebookEdit", "Agent", "Task"]) {
      it(`${spec.name}: the PreToolUse guard blocks ${tool}`, async () => {
        const outcome = await guard(`finitemonkey:${spec.name}`, tool);
        assert.equal(outcome.verdict, "block");
        assert.match(reasonText(outcome), new RegExp(`the ${spec.name} agent is read-only and cannot use ${tool}`));
      });
    }
  }

  it("researcher: no shell either, so it cannot write files through a command", () => {
    const tools = listOf(frontmatter(plugin("researcher"))["tools"]);
    assert.ok(!tools.includes("Bash") && !tools.includes("PowerShell"));
    assert.ok(tools.includes("WebFetch"));
  });

  it("the main session and other agents keep their tools", async () => {
    assert.notEqual((await guard("", "Edit")).verdict, "block");
    assert.notEqual((await guard("general-purpose", "Write")).verdict, "block");
  });
});

const CANARY = "conversation-canary-7f3a";

const setup = (): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "REVIEW.md": "Check error paths first.\n" });
  repos.push(repo);
  repo.git("switch", "-q", "-c", "feat");
  return repo;
};

const packet = async (repo: Repo) => {
  const run = await cliJson(["review", "packet", "--base", "main"], {
    cwd: repo.root,
    runtime: repoRuntime(),
    env: {},
  });
  assert.equal(run.code, 0, run.stdout);
  return { text: String(field(run.body, "data", "text")), round: Number(field(run.body, "data", "round")) };
};

describe("the review packet carries the diff, the contract and the ledger, never the conversation", () => {
  it("has exactly those sections and nothing from the session transcript", async () => {
    const repo = setup();
    const created = createTask(repoRuntime(), fmPaths(repo.root), {
      id: "t1",
      goal: "change a",
      size: "S",
      base: undefined,
      paths: ["src/**"],
      runs: [],
      tests: "node --test",
      git: [],
      manual: [],
      budget: undefined,
    });
    assert.ok(created.ok, created.ok ? "" : JSON.stringify(created.error));
    const transcripts = join(`${repo.root}-home`, ".claude", "projects", "p");
    mkdirSync(transcripts, { recursive: true });
    writeFileSync(join(transcripts, "s1.jsonl"), `${JSON.stringify({ type: "user", message: CANARY })}\n`);
    repo.write("src/a.js", "export const a = 2;\n");
    repo.commit("feat: change a");
    const { text } = await packet(repo);
    rmSync(`${repo.root}-home`, { recursive: true, force: true });
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(headings, ["Diff", "Contract", "Evidence ledger", "REVIEW.md (base branch)"]);
    assert.match(text, /-export const a = 1;\n\+export const a = 2;/);
    assert.match(text, /goal: change a/);
    assert.match(text, /Check error paths first\./);
    assert.ok(!text.includes(CANARY));
  });

  it("the plugin agents are never forks and get nothing injected at SubagentStart", () => {
    for (const name of ["reviewer", "verifier"]) {
      assert.doesNotMatch(plugin(name), /^(fork|context|inherit)\b/m);
    }
  });
});

describe("review converges", () => {
  it("rounds one to three see the whole diff; the fourth sees only what changed since round three", async () => {
    const repo = setup();
    repo.write("src/a.js", "export const a = 'alpha';\n");
    repo.commit("feat: first");
    for (const expected of [1, 2, 3]) {
      const { text, round } = await packet(repo);
      assert.equal(round, expected);
      assert.match(text, /alpha/);
    }
    repo.write("src/b.js", "export const b = 'beta';\n");
    repo.commit("feat: second");
    const fourth = await packet(repo);
    assert.equal(fourth.round, 4);
    assert.match(fourth.text, /Only the diff since the last review round/);
    assert.match(fourth.text, /beta/);
    assert.doesNotMatch(fourth.text, /alpha/);
  });
});

describe("init writes a Playwright verifier only when the project asks", () => {
  it("adds .claude/agents/verifier.md with the Playwright MCP and nothing else", async () => {
    const repo = makeRepo({ ".finitemonkey/config.yml": "review:\n  playwright: true\n" });
    repos.push(repo);
    const runtime = { ...repoRuntime(), selfPath: BUNDLE };
    const init = await cliJson(["init", "--yes"], { cwd: repo.root, runtime, env: {} });
    assert.equal(init.code, 0, init.stdout);
    const text = repo.read(".claude/agents/verifier.md");
    assert.match(text, /^mcpServers:\n {2}- playwright$/m);
    assert.match(text, /^tools: Read, Grep, Glob, Bash, mcp__playwright$/m);
    const plain = makeRepo({ "a.txt": "a\n" });
    repos.push(plain);
    await cliJson(["init", "--yes"], { cwd: plain.root, runtime, env: {} });
    assert.throws(() => plain.read(".claude/agents/verifier.md"));
  });
});
