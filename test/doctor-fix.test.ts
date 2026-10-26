import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { toPosixPath } from "../src/core/posix-path.js";
import type { Runtime } from "../src/core/runtime.js";
import { HOOK_FAILURE_EVENT } from "../src/hooks/failure-log.js";
import { DENY_RULES } from "../src/install/deny-floor.js";
import { INSTALLED_HOOKS } from "../src/install/hook-entries.js";
import { at, repo, ROOT } from "./install-support.js";
import type { MemoryFs } from "./memory-fs.js";
import { SAMPLES } from "./secret-samples.js";
import { BUNDLE, cli, cliJson, fakeRuntime, field, found, parseBody, ROOT as REPO, stdinFrom } from "./support.js";

const USER_SETTINGS = toAbsolutePath("/home/test/.claude/settings.json");
const PROFILE = toAbsolutePath("/home/test/.bashrc");
const USER_TEXT = JSON.stringify({ disableAllHooks: true, cleanupPeriodDays: 1 });
const PROFILE_TEXT = "export ANTHROPIC_BASE_URL=http://localhost:4000\n";

const runtimeOf = (fs: MemoryFs): Runtime => fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } });

const doctor = (
  fs: MemoryFs,
  argv: readonly string[],
  env: Readonly<Record<string, string>> = {},
): ReturnType<typeof cliJson> =>
  cliJson(["doctor", ...argv], { cwd: ROOT, runtime: runtimeOf(fs), env: { HOME: "/home/test", ...env } });

const installed = async (): Promise<MemoryFs> => {
  const fs = repo();
  fs.writeText(toAbsolutePath(USER_SETTINGS), USER_TEXT);
  fs.writeText(toAbsolutePath(PROFILE), PROFILE_TEXT);
  const init = await cliJson(["init", "--yes"], { cwd: ROOT, runtime: runtimeOf(fs), env: {} });
  assert.equal(init.code, 0, init.stdout);
  return fs;
};

const settingsOf = (fs: MemoryFs): JsonObject => parseBody(fs.read(at(".claude/settings.json")) ?? "{}");

const denyOf = (settings: JsonObject): readonly string[] => {
  const deny = field(settings, "permissions", "deny");
  return Array.isArray(deny) ? deny.filter((rule): rule is string => typeof rule === "string") : [];
};

const breakInstall = (fs: MemoryFs): void => {
  const settings = settingsOf(fs);
  const broken = {
    ...settings,
    hooks: {},
    permissions: { deny: denyOf(settings).filter((rule) => rule !== DENY_RULES[0]) },
  };
  fs.writeText(toAbsolutePath(at(".claude/settings.json")), JSON.stringify(broken, null, 2));
  fs.writeText(toAbsolutePath(at(".gitignore")), "node_modules/\n");
};

describe("doctor --fix", () => {
  it("re-registers hooks, restores deny rules and the .gitignore block, with a backup", async () => {
    const fs = await installed();
    breakInstall(fs);
    const result = await doctor(fs, ["--fix"]);
    const settings = settingsOf(fs);
    for (const { event } of INSTALLED_HOOKS) assert.ok(field(settings, "hooks", event) !== undefined, event);
    assert.ok(denyOf(settings).includes(DENY_RULES[0] ?? ""));
    assert.match(fs.read(at(".gitignore")) ?? "", /finitemonkey:begin/);
    assert.deepEqual(field(result.body, "data", "fixed", "written"), [".claude/settings.json", ".gitignore"]);
    const backup = String(field(result.body, "data", "fixed", "backup"));
    assert.match(fs.read(at(`${backup}/.gitignore`)) ?? "", /^node_modules\/$/m);
  });

  it("is idempotent: a second run writes nothing", async () => {
    const fs = await installed();
    breakInstall(fs);
    await doctor(fs, ["--fix"]);
    const files = fs.files();
    const writes = fs.writes();
    const second = await doctor(fs, ["--fix"]);
    assert.deepEqual(field(second.body, "data", "fixed", "written"), []);
    assert.equal(fs.writes(), writes);
    assert.deepEqual(fs.files(), files);
  });

  it("never touches user settings or the shell profile, and prints the command instead", async () => {
    const fs = await installed();
    breakInstall(fs);
    const result = await cli(["doctor", "--fix"], {
      cwd: ROOT,
      runtime: runtimeOf(fs),
      env: { HOME: "/home/test", ANTHROPIC_BASE_URL: "http://localhost:4000" },
    });
    assert.equal(fs.read(USER_SETTINGS), USER_TEXT);
    assert.equal(fs.read(PROFILE), PROFILE_TEXT);
    assert.match(result.stdout, /does not touch user settings/);
    assert.match(result.stdout, /Remove "disableAllHooks"/);
    assert.match(result.stdout, /unset ANTHROPIC_BASE_URL/);
    const touched = Object.keys(fs.files()).filter(
      (path) => !path.startsWith(toPosixPath(ROOT)) && path !== toPosixPath(BUNDLE),
    );
    assert.deepEqual(touched.sort(), [PROFILE, USER_SETTINGS].map(toPosixPath).sort());
  });

  it("--dry-run writes nothing and says what it would rewrite", async () => {
    const fs = await installed();
    breakInstall(fs);
    const writes = fs.writes();
    const result = await doctor(fs, ["--fix", "--dry-run"]);
    assert.equal(fs.writes(), writes);
    assert.deepEqual(field(result.body, "data", "fixed", "written"), [".claude/settings.json", ".gitignore"]);
  });

  it("outside an installed project it points to init", async () => {
    const fs = repo();
    const result = await doctor(fs, ["--fix"]);
    assert.equal(field(result.body, "data", "fixed", "installed"), false);
    assert.equal(fs.read(at(".claude/settings.json")), undefined);
  });
});

describe("doctor --report", () => {
  it("writes one masked Markdown file with versions, doctor --json and the last hook failures", async () => {
    const fs = await installed();
    const key = SAMPLES.githubPat;
    const rule = `- Never paste the deploy token ${key} into chat messages.\n`;
    fs.writeText(toAbsolutePath(at("AGENTS.md")), rule);
    fs.writeText(toAbsolutePath(at("CLAUDE.md")), rule);
    const failure = { at: "2026-10-25T12:00:00.000Z", event: HOOK_FAILURE_EVENT, hook: "PreToolUse", detail: key };
    fs.writeText(toAbsolutePath(at(".finitemonkey/log.jsonl")), `${JSON.stringify(failure)}\n`);
    const result = await doctor(fs, ["--report"], { GITHUB_TOKEN: key });
    const path = String(field(result.body, "data", "reportPath"));
    assert.ok(path.startsWith(join(ROOT, ".finitemonkey", "reports")), path);
    const text = fs.read(path) ?? "";
    assert.doesNotMatch(text, new RegExp(key));
    assert.doesNotMatch(result.stdout, new RegExp(key));
    assert.match(text, /«secret:[^»]+»/);
    assert.match(text, /^- finitemonkey: 9\.9\.9-test$/m);
    assert.match(text, /^- Claude Code: 2\.1\.300/m);
    assert.match(text, /"schema": "finitemonkey\/doctor@1"/);
    assert.match(text, /## Last hook failures \(1\)/);
    assert.doesNotMatch(text, /\/home\/test/);
  });
});

describe("hook failure log", () => {
  it("a hook that fails is recorded, masked, in .finitemonkey/log.jsonl", async () => {
    const fs = repo({ ".finitemonkey/config.yml": "" });
    const result = await cli(["hook", "PreToolUse"], {
      cwd: ROOT,
      runtime: runtimeOf(fs),
      stdin: stdinFrom(`not json ${SAMPLES.githubPat}`),
    });
    assert.equal(result.code, 2);
    const log = fs.read(at(".finitemonkey/log.jsonl")) ?? "";
    assert.match(log, /"event":"hook.failed","hook":"PreToolUse","verdict":"failed_closed"/);
    assert.doesNotMatch(log, new RegExp(SAMPLES.githubPat));
  });

  it("is not written when the project has no .finitemonkey directory", async () => {
    const fs = repo();
    await cli(["hook", "PreToolUse"], { cwd: ROOT, runtime: runtimeOf(fs), stdin: stdinFrom("not json") });
    assert.equal(fs.read(at(".finitemonkey/log.jsonl")), undefined);
  });
});

describe("bug template", () => {
  it("links to doctor --report", () => {
    const text = readFileSync(join(REPO, ".github", "ISSUE_TEMPLATE", "bug.yml"), "utf8");
    assert.match(text, /finitemonkey doctor --report/);
  });
});
