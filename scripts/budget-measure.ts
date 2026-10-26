import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { isRecord, type JsonObject } from "../src/core/parsed.js";
import type { Runtime } from "../src/core/runtime.js";
import { DEFAULT_HANDLERS, type HookHandler } from "../src/hooks/handlers.js";
import { createTranslator } from "../src/i18n/translate.js";
import { AGENTS_FILE, MD_BLOCK_BEGIN, MD_BLOCK_END, VERIFY_SKILL } from "../src/install/layout.js";
import { BUNDLE, cli, found, parseBody, ROOT, stdinFrom } from "../test/support.js";

export interface Measure {
  readonly name: string;
  readonly value: number;
}

const SESSION = "budget-session";

const runtime: Runtime = { ...nodeRuntime(), probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };

const git = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
};

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

const frontmatterField = (text: string, key: string): string => {
  const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const match = new RegExp(`^${key}:(.*(?:\\n[ \\t]+.*)*)`, "m").exec(head);
  return (match?.[1] ?? "").replace(/^\s*>-?\s*/, "").trim();
};

const skillFiles = (root: string): readonly string[] => [
  ...readdirSync(join(ROOT, "plugin", "skills")).map((name) => join(ROOT, "plugin", "skills", name, "SKILL.md")),
  ...readdirSync(join(ROOT, "plugin", "commands")).map((name) => join(ROOT, "plugin", "commands", name)),
  join(root, VERIFY_SKILL),
];

const descriptionMeasures = (root: string): readonly Measure[] => {
  const files = skillFiles(root).map((path) => readFileSync(path, "utf8"));
  const described = files.map((text) =>
    bytes(frontmatterField(text, "description") + frontmatterField(text, "when_to_use")),
  );
  const bodies = files.map((text) => bytes(text.replace(/^---\n[\s\S]*?\n---\n/, "")));
  return [
    { name: "descriptionBytesTotal", value: described.reduce((sum, value) => sum + value, 0) },
    { name: "descriptionBytesMax", value: Math.max(...described) },
    { name: "skillBodyBytesMax", value: Math.max(...bodies) },
  ];
};

const contextOf = (stdout: string): string => {
  const body = parseBody(stdout === "" ? "{}" : stdout);
  const specific = body["hookSpecificOutput"];
  const context = isRecord(specific) ? specific["additionalContext"] : undefined;
  return typeof context === "string" ? context : "";
};

const hookContext = async (root: AbsolutePath, event: string, extra: JsonObject): Promise<number> => {
  const input = JSON.stringify({ session_id: SESSION, cwd: root, hook_event_name: event, ...extra });
  const result = await cli(["hook", event], { cwd: root, runtime, env: {}, stdin: stdinFrom(input) });
  return bytes(contextOf(result.stdout));
};

const agentsBlockBytes = (root: string): number => {
  const text = readFileSync(join(root, AGENTS_FILE), "utf8");
  const start = text.indexOf(MD_BLOCK_BEGIN);
  const end = text.indexOf(MD_BLOCK_END);
  return start < 0 || end < start ? 0 : bytes(text.slice(start, end + MD_BLOCK_END.length));
};

const contextMeasures = async (root: AbsolutePath): Promise<readonly Measure[]> => [
  { name: "sessionStartBytes", value: await hookContext(root, "SessionStart", { source: "startup" }) },
  {
    name: "subagentStartBytes",
    value: await hookContext(root, "SubagentStart", { agent_id: "a1", agent_type: "general-purpose" }),
  },
  {
    name: "userPromptSubmitBytes",
    value: await hookContext(root, "UserPromptSubmit", { prompt: "Add Pix checkout and show the confirmation" }),
  },
  {
    name: "postToolUseBytes",
    value: await hookContext(root, "PostToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: join(root, "src", "checkout.ts"), old_string: "a", new_string: "b" },
      tool_response: { success: true },
    }),
  },
  { name: "agentsBlockBytes", value: agentsBlockBytes(root) },
];

export const GUARD_CORPUS: readonly JsonObject[] = [
  { tool_name: "Bash", tool_input: { command: "npm test -- checkout" } },
  { tool_name: "Bash", tool_input: { command: "git status" } },
  { tool_name: "Bash", tool_input: { command: "git push --force" } },
  { tool_name: "Bash", tool_input: { command: "git commit -am 'wip'" } },
  { tool_name: "Bash", tool_input: { command: "rm -rf node_modules && npm ci" } },
  { tool_name: "Bash", tool_input: { command: "sh -c 'git clean -fdx'" } },
  { tool_name: "Bash", tool_input: { command: "cat README.md | head -20" } },
  { tool_name: "Read", tool_input: { file_path: "README.md" } },
  { tool_name: "Edit", tool_input: { file_path: "src/checkout.ts", old_string: "return 1", new_string: "return 2" } },
  {
    tool_name: "Edit",
    tool_input: { file_path: "test/checkout.test.ts", old_string: 'it("pays"', new_string: 'it.skip("pays"' },
  },
  { tool_name: "Write", tool_input: { file_path: "docs/notes.md", content: "# Notes\n\nShip the checkout.\n" } },
  { tool_name: "Write", tool_input: { file_path: ".claude/settings.json", content: '{"disableAllHooks":true}\n' } },
];

const p95 = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
};

const timeGuard = async (handler: HookHandler, root: AbsolutePath, runs: number): Promise<number> => {
  const t = createTranslator("en");
  const samples: number[] = [];
  for (let run = 0; run <= runs; run += 1) {
    for (const raw of GUARD_CORPUS) {
      const payload = { hookEventName: "PreToolUse", sessionId: SESSION, cwd: root, stopHookActive: false, raw };
      const start = performance.now();
      await handler({ event: "PreToolUse", cwd: root, runtime, t, env: {}, payload });
      if (run > 0) samples.push(performance.now() - start);
    }
  }
  return p95(samples);
};

export const guardLatency = async (root: AbsolutePath, runs: number): Promise<readonly Measure[]> => {
  const measures: Measure[] = [];
  for (const handler of DEFAULT_HANDLERS.PreToolUse ?? []) {
    measures.push({ name: handler.name, value: await timeGuard(handler, root, runs) });
  }
  return measures;
};

export const withFixtureProject = async <T>(use: (root: AbsolutePath) => Promise<T>): Promise<T> => {
  const root = toAbsolutePath(realpathSync.native(mkdtempSync(join(tmpdir(), "fm-budget-"))));
  try {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.name", "Ana");
    git(root, "config", "user.email", "ana@example.com");
    const init = await cli(["init", "--yes", "--json"], { cwd: root, runtime, env: {}, version: "1.0.0" });
    if (init.code !== 0) throw new Error(`init failed: ${init.stdout}${init.stderr}`);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
    return await use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

export const measureContext = (root: AbsolutePath): Promise<readonly Measure[]> =>
  contextMeasures(root).then((context) => [...descriptionMeasures(root), ...context]);
