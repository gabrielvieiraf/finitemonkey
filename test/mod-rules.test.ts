import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rulesSection } from "../src/bridge/instructions.js";
import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const at = (path: string): AbsolutePath => toAbsolutePath(path, PROJECT);
const RULES = [
  "rules:",
  "  - id: short",
  '    text: "Keep answers short and concrete"',
  "    severity: prefer",
  "    bucket: reminder",
  "    scope: {}",
  "",
].join("\n");

const project = (mode: string) =>
  memoryFs({
    [at(".git/HEAD")]: "ref: refs/heads/feature\n",
    [at(".finitemonkey/config.yml")]: "lang: en\n",
    [at(".finitemonkey/policy.yml")]: `guards:\n  reminders: ${mode}\n`,
    [at(".finitemonkey/rules.yml")]: RULES,
  });

const sessionContext = async (mode: string): Promise<string> => {
  const runtime = fakeRuntime({ fs: project(mode) });
  const outcome = await runHook("SessionStart", {
    stdin: stdinFrom(
      JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", cwd: PROJECT, source: "startup" }),
    ),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: PROJECT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
  const text =
    outcome.stdout.trim() === ""
      ? undefined
      : field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

describe("rules for the system prompt", () => {
  it("with the mod skipped, as under sec-default, the SessionStart hook still injects the same rules", async () => {
    const section = rulesSection(fakeRuntime({ fs: project("active") }), fmPaths(PROJECT));
    assert.match(section, /Keep answers short and concrete/);
    assert.ok((await sessionContext("active")).includes(section));
  });

  it("the section is the same text on every read and empty while the reminders feature is not active", () => {
    const runtime = fakeRuntime({ fs: project("active") });
    assert.equal(rulesSection(runtime, fmPaths(PROJECT)), rulesSection(runtime, fmPaths(PROJECT)));
    assert.equal(rulesSection(fakeRuntime({ fs: project("shadow") }), fmPaths(PROJECT)), "");
  });
});
