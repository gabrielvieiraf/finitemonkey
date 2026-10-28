import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import { ExitCode } from "../src/exit-codes.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { classifyStatement } from "../src/rules/classify.js";
import { parseRules } from "../src/rules/types.js";
import { readViolations } from "../src/rules/violations.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const at = (path: string): AbsolutePath => toAbsolutePath(path, PROJECT);
const FM = at(".finitemonkey");

const AGENTS = [
  "# Agents",
  "",
  "- Never run `git push --force` on a shared branch.",
  "- Run the tests before you say a task is done.",
  "- Prefer short functions with names that explain them.",
  "- Always answer the person in Portuguese, even for code questions.",
  "- Never edit files in `dist/` by hand, the build writes them.",
  "- No Co-Authored-By lines for AI tools in commits.",
  "- Never commit straight to main, open a branch first.",
  "",
].join("\n");

const projectFs = (files: Readonly<Record<string, string>> = {}): MemoryFs =>
  memoryFs({
    [at(".git/HEAD")]: "ref: refs/heads/feature\n",
    [at(".finitemonkey/config.yml")]: "lang: en\n",
    [at(".finitemonkey/policy.yml")]:
      "guards:\n  quality: active\n  slop: active\n  tests-hold: active\n  regression: active\n  advisor: active\n  reminders: active\n  learnings: active\n  rules-stop: active\n",
    [at("AGENTS.md")]: AGENTS,
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
  });

const tty = (answers: string): TextSource => Object.assign(Readable.from([answers]), { isTTY: true });

const propose = (fs: MemoryFs, options: { stdin?: TextSource; yes?: boolean; env?: Record<string, string> } = {}) =>
  cliJson(["rules", "propose", ...(options.yes === true ? ["--yes"] : [])], {
    runtime: fakeRuntime({ fs }),
    cwd: PROJECT,
    env: options.env ?? {},
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  });

const proposalsOf = (body: unknown): readonly Readonly<Record<string, unknown>>[] => {
  const list = field(body, "data", "proposals");
  return Array.isArray(list) ? list.filter((item): item is Record<string, unknown> => typeof item === "object") : [];
};

const rulesIn = (fs: MemoryFs) => {
  const text = fs.read(at(".finitemonkey/rules.yml"));
  if (text === undefined) return undefined;
  const parsed = parseRules(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

describe("rules propose: three buckets from the instruction files", () => {
  it("proposes deterministic, end-of-turn and reminder entries with their source lines", async () => {
    const { code, body } = await propose(projectFs());
    assert.equal(code, 0);
    const rows = proposalsOf(body).map((item) => [item["origin"], item["bucket"], JSON.stringify(item["detector"])]);
    assert.deepEqual(rows, [
      ["AGENTS.md:3", "deterministic", JSON.stringify({ command: "git push --force" })],
      ["AGENTS.md:4", "stop", JSON.stringify({ check: "tests-ran" })],
      ["AGENTS.md:5", "reminder", undefined],
      ["AGENTS.md:6", "stop", JSON.stringify({ check: "language", value: "pt-BR" })],
      ["AGENTS.md:7", "deterministic", JSON.stringify({ path: "dist/**" })],
      ["AGENTS.md:8", "deterministic", JSON.stringify("attribution")],
      ["AGENTS.md:9", "stop", JSON.stringify({ check: "default-branch" })],
    ]);
  });

  it("gives reminder rules a scope to match on", () => {
    const classified = classifyStatement("Prefer named exports in `src/**/*.ts` files");
    assert.equal(classified.bucket, "reminder");
    assert.deepEqual(classified.scope.paths, ["src/**/*.ts"]);
    assert.deepEqual(classified.scope.tools, ["Edit", "Write"]);
  });

  it("skips rules already in rules.yml and the block rules compile writes", async () => {
    const rules = "rules:\n  - id: tests\n    text: Run the tests before you say a task is done\n    severity: must\n";
    const block =
      "<!-- finitemonkey:rules begin -->\n- Keep every migration reversible with a down step (rule x)\n<!-- finitemonkey:rules end -->\n";
    const { body } = await propose(projectFs({ ".finitemonkey/rules.yml": rules, "AGENTS.md": `${AGENTS}${block}` }));
    const texts = proposalsOf(body).map((item) => item["text"]);
    assert.ok(!texts.includes("Run the tests before you say a task is done."));
    assert.ok(!texts.some((text) => String(text).includes("migration")));
  });
});

describe("rules propose: nothing reaches rules.yml without confirmation", () => {
  it("without a terminal it lists the proposals and writes nothing", async () => {
    const fs = projectFs();
    const { code, body } = await propose(fs);
    assert.equal(code, 0);
    assert.deepEqual(field(body, "data", "written"), []);
    assert.equal(rulesIn(fs), undefined);
  });

  it("refuses --yes without a terminal", async () => {
    const fs = projectFs();
    const { code, body } = await propose(fs, { yes: true });
    assert.equal(code, ExitCode.NeedsPerson);
    assert.equal(field(body, "error", "code"), "needs_confirmation");
    assert.equal(rulesIn(fs), undefined);
  });

  it("refuses inside a Claude Code session even with a terminal", async () => {
    const fs = projectFs();
    await propose(fs, { stdin: tty("y\ny\ny\n"), env: { CLAUDECODE: "1" } });
    assert.equal(rulesIn(fs), undefined);
  });

  it("writes only the entries the person accepts", async () => {
    const fs = projectFs();
    const { code, body } = await propose(fs, { stdin: tty("y\nn\ny\nn\nn\nn\nn\n") });
    assert.equal(code, 0);
    assert.deepEqual(field(body, "data", "written"), [
      "never-run-git-push-force-on",
      "prefer-short-functions-with-names-that",
    ]);
    const rules = rulesIn(fs) ?? [];
    assert.deepEqual(
      rules.map((rule) => [rule.id, rule.bucket, rule.origin]),
      [
        ["never-run-git-push-force-on", "deterministic", "AGENTS.md:3"],
        ["prefer-short-functions-with-names-that", "reminder", "AGENTS.md:5"],
      ],
    );
  });

  it("--yes in a terminal accepts the whole proposal and keeps the person's entries", async () => {
    const existing =
      "# team rules\nrules:\n- id: mine\n  text: Keep the changelog out of feature commits\n  severity: prefer\n";
    const fs = projectFs({ ".finitemonkey/rules.yml": existing });
    await propose(fs, { stdin: tty(""), yes: true });
    const text = fs.read(at(".finitemonkey/rules.yml")) ?? "";
    assert.ok(text.startsWith("# team rules\nrules:\n- id: mine\n"));
    assert.equal(rulesIn(fs)?.length, 8);
  });
});

const VIOLATION = (rule: string, n: number): string =>
  `${JSON.stringify({ at: `2026-10-2${String(n)}T10:00:00.000Z`, session: `s${String(n)}`, rule, source: "person", detail: "edited dist/app.js" })}\n`;

describe("rules propose: reminders broken three times are promoted with their log", () => {
  const RULES = [
    "rules:",
    "  - id: dist-by-hand",
    "    text: Never edit files in `dist/` by hand",
    "    severity: never",
    "    bucket: reminder",
    "  - id: tone",
    "    text: Keep answers short and concrete",
    "    severity: prefer",
    "",
  ].join("\n");

  it("proposes the promotion with the three violations as evidence", async () => {
    const log =
      [1, 2, 3].map((n) => VIOLATION("dist-by-hand", n)).join("") + VIOLATION("tone", 4) + VIOLATION("tone", 5);
    const fs = projectFs({
      ".finitemonkey/rules.yml": RULES,
      ".finitemonkey/rule-violations.jsonl": log,
      "AGENTS.md": "# empty\n",
    });
    const { body } = await propose(fs);
    const proposals = proposalsOf(body);
    const [first] = proposals;
    assert.ok(first !== undefined && proposals.length === 1);
    assert.equal(first["kind"], "promote");
    assert.equal(first["id"], "dist-by-hand");
    assert.equal(first["bucket"], "deterministic");
    const evidence = first["evidence"];
    assert.ok(Array.isArray(evidence) && evidence.length === 3);
    await propose(fs, { stdin: tty("y\n") });
    const promoted = rulesIn(fs)?.find((rule) => rule.id === "dist-by-hand");
    assert.equal(promoted?.bucket, "deterministic");
    assert.deepEqual(promoted.detector, {
      kind: "path",
      path: "dist/**",
      tools: ["Write", "Edit", "MultiEdit", "NotebookEdit"],
    });
  });

  it("rules violation records the person's report", async () => {
    const fs = projectFs({ ".finitemonkey/rules.yml": RULES });
    const { code, body } = await cliJson(["rules", "violation", "tone", "--detail", "three paragraphs for a yes"], {
      runtime: fakeRuntime({ fs }),
      cwd: PROJECT,
    });
    assert.equal(code, 0);
    assert.equal(field(body, "data", "count"), 1);
    assert.deepEqual(
      readViolations(fakeRuntime({ fs }), FM).map((item) => [item.rule, item.source]),
      [["tone", "person"]],
    );
  });
});

const transcript = (tools: readonly Readonly<Record<string, unknown>>[], text = "Done."): string =>
  [
    JSON.stringify({ type: "user", message: { role: "user", content: "Fix the checkout total" } }),
    ...tools.map((tool, index) =>
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: `t${String(index)}`, ...tool }] },
      }),
    ),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }),
    "",
  ].join("\n");

const STOP_RULES = [
  "rules:",
  "  - id: tests-ran",
  "    text: Run the tests before you say a task is done",
  "    severity: must",
  "    detector:",
  "      check: tests-ran",
  "",
].join("\n");

const stop = async (fs: MemoryFs, extra: Readonly<Record<string, unknown>> = {}) => {
  const runtime = fakeRuntime({ fs });
  return runHook("Stop", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: "s1",
        cwd: PROJECT,
        transcript_path: at("t.jsonl"),
        ...extra,
      }),
    ),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: PROJECT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

describe("rules checked at Stop", () => {
  const EDIT = { name: "Edit", input: { file_path: at("src/total.ts"), old_string: "a", new_string: "b" } };

  it("blocks the end of the turn when code changed and no test ran after it, and logs the violation", async () => {
    const fs = projectFs({ ".finitemonkey/rules.yml": STOP_RULES, "t.jsonl": transcript([EDIT]) });
    const outcome = await stop(fs);
    assert.equal(outcome.verdict, "block");
    assert.match(outcome.stdout + outcome.stderr, /tests-ran/);
    assert.deepEqual(
      readViolations(fakeRuntime({ fs }), FM).map((item) => [item.rule, item.source]),
      [["tests-ran", "stop"]],
    );
  });

  it("lets the turn end when the tests ran after the last edit", async () => {
    const ran = { name: "Bash", input: { command: "npm test" } };
    const fs = projectFs({ ".finitemonkey/rules.yml": STOP_RULES, "t.jsonl": transcript([EDIT, ran]) });
    assert.equal((await stop(fs)).verdict, "allow");
  });

  it("checks the answer language", async () => {
    const rules =
      "rules:\n  - id: pt\n    text: Always answer in Portuguese\n    severity: must\n    detector:\n      check: language\n      value: pt-BR\n";
    const english =
      "I changed the total and it is now right. The tests are green and the page shows the value that the person expects, so this is done for the checkout.";
    const fs = projectFs({ ".finitemonkey/rules.yml": rules, "t.jsonl": transcript([], english) });
    assert.equal((await stop(fs, { last_assistant_message: english })).verdict, "block");
    const portuguese =
      "Eu mudei o total e agora está certo. Os testes passam e a página mostra o valor que a pessoa espera, então isso não precisa de mais nada, e também está no ar.";
    assert.equal((await stop(fs, { last_assistant_message: portuguese })).verdict, "allow");
  });

  it("only records in shadow mode", async () => {
    const fs = projectFs({
      ".finitemonkey/rules.yml": STOP_RULES,
      ".finitemonkey/policy.yml": "guards:\n  rules-stop: shadow\n",
      "t.jsonl": transcript([EDIT]),
    });
    assert.equal((await stop(fs)).verdict, "allow");
    assert.equal(readViolations(fakeRuntime({ fs }), FM).length, 1);
  });
});
