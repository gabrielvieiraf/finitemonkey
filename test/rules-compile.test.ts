import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { checkRules } from "../src/doctor/rules.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { at, repo, ROOT, run } from "./install-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, execResult, fakeRuntime, field, found, stdinFrom } from "./support.js";

const RULES = [
  "schemaVersion: 1",
  "rules:",
  "  - id: no-force-push",
  "    text: Never force push a shared branch",
  '    origin: "review of PR 12, 2026-10-20"',
  "    severity: never",
  "    detector:",
  '      command: "git push --force"',
  "  - id: no-wip-commits",
  "    text: Do not commit work in progress",
  '    origin: "team decision, 2026-10-21"',
  "    severity: must",
  "    detector:",
  '      text: "^wip\\\\b"',
  "      on: [commit, pr]",
  "",
].join("\n");

const PROSE = "# Rules\n\nNever force push a shared branch.\n";

const coverage = async (fs: ReturnType<typeof repo>) => {
  const result = await run(fs, ["rules", "coverage"]);
  const rules = field(result.body, "data", "rules");
  const list: readonly unknown[] = Array.isArray(rules) ? rules : [];
  return {
    code: result.code,
    stdout: result.stdout,
    status: Object.fromEntries(list.map((item) => [String(field(item, "id")), field(item, "status")])),
  };
};

describe("rules coverage before and after compile", () => {
  it("a rule only in prose shows text only; after compile it shows full coverage", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES, "AGENTS.md": PROSE });
    const before = await coverage(fs);
    assert.equal(before.code, 1);
    assert.deepEqual(before.status, { "no-force-push": "text only", "no-wip-commits": "none" });
    const compiled = await run(fs, ["rules", "compile", "--ci"]);
    assert.equal(compiled.code, 0, compiled.stdout);
    const afterCompile = await coverage(fs);
    assert.equal(afterCompile.code, 0, afterCompile.stdout);
    assert.deepEqual(afterCompile.status, { "no-force-push": "full", "no-wip-commits": "full" });
  });

  it("compile writes each output marked by id", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES });
    await run(fs, ["rules", "compile", "--ci"]);
    const settings = fs.read(at(".claude/settings.json")) ?? "";
    assert.match(settings, /"Bash\(git push --force:\*\)"/);
    assert.match(settings, /finitemonkey:rules-presence/);
    assert.match(fs.read(at("AGENTS.md")) ?? "", /- Never force push a shared branch \(rule no-force-push\)/);
    const workflow = fs.read(at(".github/workflows/finitemonkey-rules.yml")) ?? "";
    assert.match(workflow, /# finitemonkey:rule no-force-push\n {6}# finitemonkey:rule no-wip-commits/);
    assert.match(workflow, /rules check --ci/);
  });

  it("without --ci a never rule stays partial and coverage says so", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES });
    const compiled = await cli(["rules", "compile"], { cwd: ROOT, runtime: fakeRuntime({ fs }) });
    assert.match(compiled.stdout + compiled.stderr, /rules compile --ci/);
    const result = await coverage(fs);
    assert.equal(result.code, 1);
    assert.equal(result.status["no-force-push"], "partial");
  });
});

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

describe("compiled rules are enforced", () => {
  it("the guard blocks a command rule only once it is compiled", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES });
    const runtime = fakeRuntime({ fs });
    assert.equal((await fire(runtime, "git push origin feature --force")).verdict, "allow");
    await run(fs, ["rules", "compile"]);
    const outcome = await fire(runtime, "git push origin feature --force");
    assert.equal(outcome.verdict, "block");
    assert.match(outcome.stdout, /project rule no-force-push: Never force push a shared branch/);
    assert.equal((await fire(runtime, "git push origin feature")).verdict, "allow");
  });

  it("the commit-msg hook checks a commit text rule", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES, "msg.txt": "wip: half of the checkout\n" });
    await run(fs, ["rules", "compile"]);
    const result = await run(fs, ["commit-msg", "msg.txt"]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /rule no-wip-commits/);
  });
});

const repos: Repo[] = [];
after(() => {
  for (const item of repos) item.cleanup();
});

describe("the CI step", () => {
  it("checks the PR text and the commits of the branch", async () => {
    const git = makeRepo({ ".finitemonkey/rules.yml": RULES, "src/a.ts": "export const a = 1;\n" });
    repos.push(git);
    const runtime = repoRuntime();
    assert.equal((await cliJson(["rules", "compile", "--ci"], { cwd: git.root, runtime })).code, 0);
    git.commit("chore: compile rules");
    git.git("checkout", "-q", "-b", "feature");
    git.write("src/a.ts", "export const a = 2;\n");
    git.commit("wip: try a");
    git.write("event.json", JSON.stringify({ pull_request: { title: "feat: a", body: "Adds `wip` handling." } }));
    const result = await cliJson(["rules", "check", "--ci", "--base", "main"], {
      cwd: git.root,
      runtime,
      env: { GITHUB_EVENT_PATH: toAbsolutePath("event.json", git.root) },
    });
    assert.equal(result.code, 1);
    const checks = field(result.body, "data", "checks");
    const list: readonly unknown[] = Array.isArray(checks) ? checks : [];
    const first = list[0];
    const failures = field(first, "failures");
    assert.ok(Array.isArray(failures));
    assert.equal(failures.length, 1);
    assert.match(String(failures[0]), /^[0-9a-f]+: rule no-wip-commits/);
  });
});

describe("doctor and the CI cell", () => {
  const doctorWith = (fs: ReturnType<typeof repo>, ghOut: string) => {
    const calls: ExecRequest[] = [];
    const runtime = fakeRuntime({
      fs,
      exec: (request) => {
        calls.push(request);
        return request.command === "gh" ? execResult(0, ghOut) : undefined;
      },
    });
    return {
      found: checkRules({ platform: "linux", env: {}, cwd: ROOT, root: ROOT, version: "1.0.0", runtime }),
      calls,
    };
  };

  it('marks the CI cell "not required" when the ruleset does not require the check', async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES });
    await run(fs, ["rules", "compile", "--ci"]);
    const other = JSON.stringify([
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "build" }] } },
    ]);
    const { found: notRequired, calls } = doctorWith(fs, other);
    assert.deepEqual(
      notRequired.map((item) => [item.check, item.status, item.messageKey]),
      [["rules.ci", "warn", "rules.doctor.ci_not_required"]],
    );
    assert.deepEqual(calls[0]?.args, ["api", "repos/{owner}/{repo}/rules/branches/main"]);
    const required = JSON.stringify([
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "finitemonkey rules" }] } },
    ]);
    assert.deepEqual(doctorWith(fs, required).found, []);
  });

  it("fails a never rule that is only text", () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES, "AGENTS.md": PROSE });
    const { found: findings } = doctorWith(fs, "[]");
    assert.deepEqual(
      findings.map((item) => [item.check, item.status, item.params?.["id"]]),
      [
        ["rules.coverage", "fail", "no-force-push"],
        ["rules.coverage", "warn", "no-wip-commits"],
      ],
    );
  });
});

describe("uninstall", () => {
  it("removes every compiled output by id", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES, "AGENTS.md": PROSE });
    const runtime = fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } });
    assert.equal((await cliJson(["init", "--yes"], { cwd: ROOT, runtime, env: {} })).code, 0);
    const installed = fs.read(at(".claude/settings.json"));
    assert.equal((await cliJson(["rules", "compile", "--ci"], { cwd: ROOT, runtime, env: {} })).code, 0);
    assert.equal((await cliJson(["uninstall", "--yes"], { cwd: ROOT, runtime, env: {} })).code, 0);
    const settings = fs.read(at(".claude/settings.json")) ?? "";
    assert.doesNotMatch(settings, /git push --force|rules-presence/);
    assert.notEqual(installed, undefined);
    assert.doesNotMatch(fs.read(at("AGENTS.md")) ?? "", /finitemonkey:rules|rule no-force-push/);
    assert.equal(fs.read(at(".github/workflows/finitemonkey-rules.yml")), undefined);
    assert.equal(fs.read(at(".finitemonkey/rules-compiled.json")), undefined);
    assert.match(fs.read(at("AGENTS.md")) ?? "", /Never force push a shared branch\./);
  });
});
