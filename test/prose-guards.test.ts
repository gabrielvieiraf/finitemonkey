import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { proseInCommand } from "../src/prose/command-text.js";
import { fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const GABRIEL = { [`${ROOT}/.finitemonkey/config.yml`]: "schemaVersion: 1\npreset: gabriel\nlang: en\n" };
const BAD = "This change leverages the invite flow for a seamless, robust first run. Nobody is lazy here.";
const GOOD = "An accepted finding came back as new on every run, so the command exited 1 on a clean repository.";
const MARKER = "<!-- finitemonkey:prose-allow -->";

const fire = (input: Readonly<Record<string, unknown>>, runtime: Runtime = fakeRuntime()): Promise<HookOutcome> =>
  runHook("PreToolUse", {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", cwd: ROOT, ...input })),
    deadlineMs: 2000,
    handlers: DEFAULT_HANDLERS,
    cwd: ROOT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  });

const bash = (command: string): Readonly<Record<string, unknown>> => ({ tool_name: "Bash", tool_input: { command } });

const context = (outcome: HookOutcome): string => {
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

const heredocCommit = `git commit -m "$(cat <<'EOF'\nfeat: onboarding\n\n${BAD}\nEOF\n)"`;

const commands = [
  { name: "git commit -m twice", command: `git commit -m "feat: onboarding" -m "${BAD}"`, target: "commit" },
  { name: "git commit with a heredoc", command: heredocCommit, target: "commit" },
  { name: "git -C dir commit -am", command: `git -C app commit -am "${BAD}"`, target: "commit" },
  { name: "gh pr create --body", command: `gh pr create --title "feat: x" --body "${BAD}"`, target: "PR" },
  { name: "gh pr edit --body=", command: `gh pr edit 3 --body="${BAD}"`, target: "PR" },
  { name: "gh pr create --body-file -", command: `gh pr create -t x --body-file - <<'EOF'\n${BAD}\nEOF`, target: "PR" },
  { name: "gh issue create -b", command: `cd app && gh issue create -t "bug" -b '${BAD}'`, target: "issue" },
] as const;

describe("prose check on commit, PR and issue text", () => {
  for (const { name, command, target } of commands) {
    it(`${name}: warns in the neutral preset`, async () => {
      const outcome = await fire(bash(command));
      assert.equal(outcome.verdict, "allow");
      assert.match(context(outcome), new RegExp(`The ${target} (message|text) reads as machine-written`));
      assert.match(context(outcome), /crutch-word "leverages"/);
    });

    it(`${name}: blocks in the gabriel preset`, async () => {
      const outcome = await fire(bash(command), fakeRuntime({ files: GABRIEL }));
      assert.equal(outcome.verdict, "block");
      assert.match(outcome.stderr, /blocked: .*reads as machine-written .*Rewrite it and run the command again/);
    });
  }

  it("a commit that names a person as the reason is blocked in the gabriel preset", async () => {
    const command = bash(`git commit -m "docs: introdução do readme com o texto do gabriel"`);
    const outcome = await fire(command, fakeRuntime({ files: GABRIEL }));
    assert.equal(outcome.verdict, "block");
    assert.match(outcome.stderr, /person-as-reason/);
    assert.match(context(await fire(command)), /person-as-reason/);
  });

  it("reads --body-file from disk", async () => {
    const runtime = fakeRuntime({ files: { ...GABRIEL, [`${ROOT}/body.md`]: `## Summary\n\n${BAD}\n` } });
    const outcome = await fire(bash("gh pr create --title x --body-file body.md"), runtime);
    assert.equal(outcome.verdict, "block");
  });

  it("a missing --body-file blocks in the gabriel preset and passes in neutral", async () => {
    const command = bash("gh pr create --title x --body-file missing.md");
    assert.match((await fire(command, fakeRuntime({ files: GABRIEL }))).stderr, /could not read missing\.md/);
    assert.equal((await fire(command)).verdict, "allow");
  });

  const clean = [
    `git commit -m "fix(secrets): read the baseline first" -m "${GOOD}"`,
    `gh pr create --title "fix: baseline" --body "${GOOD}"`,
    "git commit --amend --no-edit",
    "git log --oneline -5",
    `echo "${BAD}"`,
  ];
  for (const command of clean) {
    it(`passes quietly: ${command.slice(0, 50)}`, async () => {
      const outcome = await fire(bash(command), fakeRuntime({ files: GABRIEL }));
      assert.equal(outcome.verdict, "allow");
      assert.equal(context(outcome), "");
    });
  }
});

describe("the allow marker is the person's, never the model's", () => {
  const readme = `${ROOT}/README.md`;
  const blocked = [
    {
      name: "Write a new file with it",
      input: { tool_name: "Write", tool_input: { file_path: readme, content: `${MARKER}\nx` } },
    },
    {
      name: "Edit that adds it",
      input: { tool_name: "Edit", tool_input: { file_path: readme, old_string: "a", new_string: `a ${MARKER}` } },
    },
    {
      name: "MultiEdit that adds it",
      input: {
        tool_name: "MultiEdit",
        tool_input: { file_path: readme, edits: [{ old_string: "a", new_string: MARKER }] },
      },
    },
    { name: "echo into a file", input: bash(`echo '${MARKER}' >> README.md`) },
    { name: "a commit message", input: bash(`git commit -m "brand line ${MARKER}"`) },
  ];
  for (const { name, input } of blocked) {
    it(`blocks: ${name}`, async () => {
      const outcome = await fire(input);
      assert.equal(outcome.verdict, "block");
      assert.match(outcome.stderr, /only the person can add it/);
    });
  }

  const allowed = [
    {
      name: "Write that keeps a marker already there",
      input: { tool_name: "Write", tool_input: { file_path: readme, content: `${MARKER}\nnew text` } },
      files: { [readme]: `${MARKER}\nold text` },
    },
    {
      name: "Edit that moves an existing marker",
      input: {
        tool_name: "Edit",
        tool_input: { file_path: readme, old_string: `${MARKER}\na`, new_string: `a\n${MARKER}` },
      },
      files: {},
    },
    { name: "grep for the marker", input: bash("grep -rn finitemonkey:prose-allow docs"), files: {} },
    {
      name: "a PR body that names the marker in inline code",
      input: bash("gh pr create --title t --body 'the person adds `finitemonkey:prose-allow-file`'"),
      files: {},
    },
    {
      name: "docs that mention the marker without the comment",
      input: { tool_name: "Write", tool_input: { file_path: readme, content: "Add finitemonkey:prose-allow." } },
      files: {},
    },
  ];
  for (const { name, input, files } of allowed) {
    it(`allows: ${name}`, async () => {
      assert.equal((await fire(input, fakeRuntime({ files }))).verdict, "allow");
    });
  }
});

describe("command text extraction", () => {
  it("keeps quoted separators and newlines inside the message", () => {
    const [found] = proseInCommand(`git commit -m "first; second | third\nfourth"`);
    assert.deepEqual(found?.bodies, [{ kind: "inline", text: "first; second | third\nfourth" }]);
  });

  it("finds the PR title and body in a chained command", () => {
    const [found] = proseInCommand(`git push -u origin x && gh pr create --base next --title "feat: a" --body b`);
    assert.equal(found?.target, "pr");
    assert.deepEqual(found.title, { kind: "inline", text: "feat: a" });
    assert.deepEqual(found.bodies, [{ kind: "inline", text: "b" }]);
  });

  it("ignores other gh and git commands", () => {
    assert.deepEqual(proseInCommand("gh pr view 3 --json body && git status"), []);
  });
});
