import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { at, repo, ROOT, run } from "./install-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, fakeRuntime, field, stdinFrom } from "./support.js";

const STRICT = { ".finitemonkey/config.yml": "schemaVersion: 1\npreset: gabriel\nlang: en\n" };
const DECLARED = { ".finitemonkey/rules.yml": "rules:\n  - id: no-attribution\n    preset: attribution\n" };
const CO_AUTHOR = "Co-Authored-By: Claude Opus <noreply@anthropic.com>";

const fire = (runtime: Runtime, command: string): Promise<HookOutcome> =>
  runHook("PreToolUse", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        cwd: ROOT,
        tool_name: "Bash",
        tool_input: { command },
      }),
    ),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: ROOT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  });

const ids = async (fs: ReturnType<typeof repo>): Promise<readonly string[]> => {
  const rules = field((await run(fs, ["rules", "coverage"])).body, "data", "rules");
  return Array.isArray(rules) ? rules.map((rule: unknown) => String(field(rule, "id"))) : [];
};

describe("no-attribution: presets", () => {
  it("is off in the neutral preset and on in the strict preset", async () => {
    assert.deepEqual(await ids(repo({})), []);
    assert.deepEqual(await ids(repo(STRICT)), ["no-attribution"]);
    assert.deepEqual(await ids(repo(DECLARED)), ["no-attribution"]);
  });
});

describe("no-attribution: each compiled output", () => {
  it("settings: compile writes the attribution key with empty strings", async () => {
    const fs = repo(STRICT);
    assert.equal(fs.read(at(".claude/settings.json")), undefined);
    await run(fs, ["rules", "compile", "--ci"]);
    const settings = JSON.parse(fs.read(at(".claude/settings.json")) ?? "{}") as Record<string, unknown>;
    assert.deepEqual(settings["attribution"], { commit: "", pr: "", sessionUrl: false });
    const coverage = await run(fs, ["rules", "coverage"]);
    assert.equal(coverage.code, 0);
  });

  it("guard: blocks a commit and a PR with attribution, lets clean text through", async () => {
    const fs = repo(STRICT);
    const runtime = fakeRuntime({ fs });
    await run(fs, ["rules", "compile"]);
    assert.equal((await fire(runtime, `git commit -m "feat: x" -m "${CO_AUTHOR}"`)).verdict, "block");
    assert.equal(
      (await fire(runtime, 'gh pr edit 12 --title "feat: x" --body "Done. 🤖 Generated with Claude Code"')).verdict,
      "block",
    );
    assert.equal((await fire(runtime, 'git commit -m "feat: x" -m "Adds the cart total."')).verdict, "allow");
  });

  it("guard: ignores the words inside code blocks of the PR body", async () => {
    const fs = repo(STRICT);
    const runtime = fakeRuntime({ fs });
    await run(fs, ["rules", "compile"]);
    const body = `The hook now rejects lines like this one:\n\n\`\`\`\n${CO_AUTHOR}\n\`\`\`\n\nand inline \`🤖\` too.`;
    const command = `gh pr edit 12 --title "feat: reject attribution" --body-file - <<'EOF'\n${body}\nEOF`;
    assert.equal((await fire(runtime, command)).verdict, "allow");
  });

  it("commit-msg hook: fails with an AI co-author, passes without", async () => {
    const fs = repo({ ...STRICT, "bad.txt": `feat: x\n\n${CO_AUTHOR}\n`, "good.txt": "feat: x\n\nAdds the total.\n" });
    await run(fs, ["rules", "compile"]);
    assert.equal((await run(fs, ["commit-msg", "bad.txt"])).code, 1);
    assert.equal((await run(fs, ["commit-msg", "good.txt"])).code, 0);
  });
});

const repos: Repo[] = [];
after(() => {
  for (const item of repos) item.cleanup();
});

describe("no-attribution: the CI step", () => {
  const branch = (body: string, message: string) => {
    const git = makeRepo({ ...STRICT, "src/a.ts": "export const a = 1;\n" });
    repos.push(git);
    git.git("checkout", "-q", "-b", "feature");
    git.write("src/a.ts", "export const a = 2;\n");
    git.commit(message);
    git.write("event.json", JSON.stringify({ pull_request: { title: "feat: a", body } }));
    return git;
  };

  const check = async (git: Repo) => {
    const runtime = repoRuntime();
    await cliJson(["rules", "compile", "--ci"], { cwd: git.root, runtime });
    return cliJson(["rules", "check", "--ci", "--base", "main"], {
      cwd: git.root,
      runtime,
      env: { GITHUB_EVENT_PATH: toAbsolutePath("event.json", git.root) },
    });
  };

  it("fails on attribution in the PR body or a commit", async () => {
    assert.equal(
      (await check(branch("Done.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)", "feat: a"))).code,
      1,
    );
    assert.equal((await check(branch("Done.", `feat: a\n\n${CO_AUTHOR}`))).code, 1);
  });

  it("passes on clean text", async () => {
    assert.equal((await check(branch("Changes the value of a.", "feat: a"))).code, 0);
  });
});
