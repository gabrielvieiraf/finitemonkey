import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { readOnlyViolation } from "../src/review/read-only-shell.js";
import { fakeRuntime, reasonText, stdinFrom } from "./support.js";

const CWD = toAbsolutePath("/home/ana/project");

const bash = async (agentType: string, command: string) => {
  const runtime = fakeRuntime();
  return runHook("PreToolUse", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        cwd: CWD,
        agent_id: "a1",
        agent_type: agentType,
        tool_name: "Bash",
        tool_input: { command },
      }),
    ),
    deadlineMs: 2000,
    handlers: DEFAULT_HANDLERS,
    cwd: CWD,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  });
};

const WRITES = [
  "echo done > notes.txt",
  "touch src/a.ts",
  "npm install left-pad",
  "pip install requests",
  "sed -i s/a/b/ src/a.ts",
  "rm -f src/a.ts",
  "cat src/a.ts | tee copy.ts",
  "node -e \"require('fs').writeFileSync('x', '1')\"",
  "git checkout -- src/a.ts",
  "finitemonkey critique verify --base main > out.txt",
  "npm test > results.txt",
  "npx vitest run -u",
  "npx jest --updateSnapshot",
];

const READS = [
  "cat src/a.ts | grep charge",
  "git diff main -- src/a.ts",
  "ls -la src",
  'echo \'{"verdict":"approve","findings":[]}\' | finitemonkey critique verify --base main',
  "npx finitemonkey critique verify --base main --file review.json",
  "npm test",
  "npx vitest run",
  "pytest -q",
  "node --test test/a.test.js",
];

describe("the verifier agent runs Bash read-only", () => {
  for (const command of WRITES) {
    it(`denies ${JSON.stringify(command)}`, async () => {
      const outcome = await bash("finitemonkey:verifier", command);
      assert.equal(outcome.verdict, "block");
      assert.match(reasonText(outcome), /the verifier agent runs only read-only commands/);
    });
  }

  for (const command of READS) {
    it(`lets ${JSON.stringify(command)} through`, () => {
      assert.equal(readOnlyViolation(command, "bash", { cwd: CWD, repoRoot: CWD }), undefined);
    });
  }

  it("denies the verifier writing a file through Bash", async () => {
    const outcome = await bash("verifier", "printf 'fixed' > src/a.ts");
    assert.equal(outcome.verdict, "block");
    assert.match(reasonText(outcome), /writes, redirects or installs/);
  });

  it("the main session keeps its Bash", async () => {
    const outcome = await bash("", "echo done > notes.txt");
    assert.doesNotMatch(reasonText(outcome), /read-only commands/);
  });
});
