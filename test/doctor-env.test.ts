import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { doctorResult } from "../src/commands/doctor.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { GitResult, ProbeResult } from "../src/core/runtime.js";
import { buildReport, runChecks } from "../src/doctor/run.js";
import type { CheckFinding, DoctorEnv } from "../src/doctor/types.js";
import { catalogs } from "../src/i18n/catalogs.js";
import { LANGUAGES } from "../src/i18n/languages.js";
import { fakeCtx, fakeRuntime, found, missing, ROOT } from "./support.js";

const PROJECT = "/home/ana/project";
const USER_SETTINGS = "/home/test/.claude/settings.json";
const MANAGED = "/etc/claude-code/managed-settings.json";

interface Fixture {
  readonly platform?: NodeJS.Platform;
  readonly nodeVersion?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly project?: Readonly<Record<string, string>>;
  readonly tools?: Readonly<Record<string, ProbeResult>>;
  readonly git?: (args: readonly string[]) => GitResult;
}

const HEALTHY_TOOLS: Readonly<Record<string, ProbeResult>> = {
  git: found("git version 2.47.1"),
  claude: found("2.1.300 (Claude Code)"),
  bwrap: found("bubblewrap 0.9.0"),
  socat: found("socat version 1.8"),
};

const projectPath = (relative: string): string => toAbsolutePath(join(PROJECT, ...relative.split("/")));

const machine = (fixture: Fixture = {}): DoctorEnv => {
  const files: Readonly<Record<string, string>> = Object.fromEntries([
    [toAbsolutePath("/proc/version"), "Linux version 6.8.0-generic"] as const,
    ...Object.entries(fixture.files ?? {}).map(([path, text]) => [toAbsolutePath(path), text] as const),
    ...Object.entries(fixture.project ?? {}).map(([path, text]) => [projectPath(path), text] as const),
  ]);
  return {
    platform: fixture.platform ?? "linux",
    env: { PATH: "/usr/local/bin:/usr/bin", ...fixture.env },
    cwd: toAbsolutePath(PROJECT),
    root: toAbsolutePath(PROJECT),
    runtime: fakeRuntime({
      nodeVersion: fixture.nodeVersion ?? "22.11.0",
      tools: { ...HEALTHY_TOOLS, ...fixture.tools },
      files,
      ...(fixture.git === undefined ? {} : { git: fixture.git }),
    }),
  };
};

const settings = (value: object): string => JSON.stringify(value);

const NOT_OK = (finding: CheckFinding): boolean => finding.status !== "ok";

const firing = (fixture: Fixture, check: string): readonly CheckFinding[] =>
  runChecks(machine(fixture)).filter((finding) => finding.check === check && NOT_OK(finding));

const firstCommit =
  (daysAgo: number) =>
  (args: readonly string[]): GitResult => {
    if (args[0] !== "log") return { found: true, ok: false, stdout: "" };
    const seconds = Math.floor((Date.parse("2026-10-25T12:00:00.000Z") - daysAgo * 86400000) / 1000);
    return { found: true, ok: true, stdout: `${String(seconds)}\n` };
  };

const LONG = Array.from({ length: 201 }, (_, index) => `- rule number ${String(index)}`).join("\n");
const SHARED = "- Run the full test suite before you say a task is done.\n";

interface Case {
  readonly check: string;
  readonly status: "warn" | "fail";
  readonly fire: Fixture;
  readonly quiet: Fixture;
}

const CASES: Readonly<Record<string, Case>> = {
  "claudeignore without deny rules": {
    check: "instructions.claudeignore",
    status: "warn",
    fire: { project: { ".claudeignore": "secrets/\n" } },
    quiet: {
      project: {
        ".claudeignore": "secrets/\n",
        ".claude/settings.json": settings({ permissions: { deny: ["Read(secrets/**)"] } }),
      },
    },
  },
  "CLAUDE.local.md": {
    check: "instructions.local",
    status: "warn",
    fire: { project: { "AGENTS.md": "# Rules\n", "CLAUDE.local.md": "# Mine\n" } },
    quiet: { project: { "AGENTS.md": "# Rules\n", "CLAUDE.md": "@AGENTS.md\n" } },
  },
  "deny rule that hides AGENTS.md": {
    check: "instructions.denied",
    status: "fail",
    fire: {
      project: {
        "AGENTS.md": "# Rules\n",
        ".claude/settings.json": settings({ permissions: { deny: ["Read(*.md)"] } }),
      },
    },
    quiet: {
      project: {
        "AGENTS.md": "# Rules\n",
        ".claude/settings.json": settings({ permissions: { deny: ["Read(./docs/private/**)"] } }),
      },
    },
  },
  disableAllHooks: {
    check: "settings.disable_all_hooks",
    status: "fail",
    fire: { files: { [USER_SETTINGS]: settings({ disableAllHooks: true }) } },
    quiet: { files: { [USER_SETTINGS]: settings({ disableAllHooks: false }) } },
  },
  allowManagedHooksOnly: {
    check: "settings.managed_hooks_only",
    status: "fail",
    fire: { files: { [MANAGED]: settings({ allowManagedHooksOnly: true }) } },
    quiet: { files: { [MANAGED]: settings({}) } },
  },
  strictPluginOnlyCustomization: {
    check: "settings.plugin_only",
    status: "fail",
    fire: { files: { [MANAGED]: settings({ strictPluginOnlyCustomization: true }) } },
    quiet: {
      files: { [MANAGED]: settings({ strictPluginOnlyCustomization: true }) },
      project: { ".claude/settings.json": settings({ enabledPlugins: { "finitemonkey@finitemonkey": true } }) },
    },
  },
  "agent teams variable": {
    check: "settings.agent_teams",
    status: "warn",
    fire: { files: { [USER_SETTINGS]: settings({ env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" } }) } },
    quiet: { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "0" } },
  },
  "loop plugin without the guard": {
    check: "settings.loop_plugins",
    status: "warn",
    fire: { files: { [USER_SETTINGS]: settings({ enabledPlugins: { "ralph-loop@claude-plugins": true } }) } },
    quiet: { files: { [USER_SETTINGS]: settings({ enabledPlugins: { "ralph-loop@claude-plugins": false } }) } },
  },
  "cleanupPeriodDays shorter than the project": {
    check: "settings.cleanup_period",
    status: "warn",
    fire: { files: { [USER_SETTINGS]: settings({ cleanupPeriodDays: 30 }) }, git: firstCommit(100) },
    quiet: { files: { [USER_SETTINGS]: settings({ cleanupPeriodDays: 365 }) }, git: firstCommit(100) },
  },
  "sandbox tools missing": {
    check: "sandbox",
    status: "warn",
    fire: { tools: { bwrap: missing } },
    quiet: {},
  },
  "native Windows without sandbox": {
    check: "sandbox",
    status: "warn",
    fire: { platform: "win32", env: { Path: "C:\\Windows" } },
    quiet: { platform: "darwin" },
  },
  "synced folder": {
    check: "path.synced",
    status: "warn",
    fire: {},
    quiet: {},
  },
  "git older than 2.38": {
    check: "git",
    status: "warn",
    fire: { tools: { git: found("git version 2.34.1") } },
    quiet: { tools: { git: found("git version 2.38.0") } },
  },
  "Claude Code older than the minimum": {
    check: "claude.version",
    status: "warn",
    fire: { tools: { claude: found("2.1.200 (Claude Code)") } },
    quiet: { tools: { claude: found("2.1.295 (Claude Code)") } },
  },
  "Node out of support": {
    check: "node.support",
    status: "warn",
    fire: { nodeVersion: "20.18.0" },
    quiet: { nodeVersion: "22.11.0" },
  },
  "another finitemonkey on PATH": {
    check: "path.copies",
    status: "warn",
    fire: {
      env: { PATH: "/opt/a/bin:/opt/b/bin" },
      files: { "/opt/a/bin/finitemonkey": "#!", "/opt/b/bin/finitemonkey": "#!" },
    },
    quiet: { env: { PATH: "/opt/a/bin:/opt/b/bin" }, files: { "/opt/a/bin/finitemonkey": "#!" } },
  },
  "two JavaScript lockfiles": {
    check: "project.lockfiles",
    status: "warn",
    fire: { project: { "package-lock.json": "{}", "yarn.lock": "" } },
    quiet: { project: { "package-lock.json": "{}", "poetry.lock": "" } },
  },
  "two ESLint configs": {
    check: "project.configs",
    status: "warn",
    fire: { project: { "eslint.config.mjs": "", ".eslintrc.json": "{}" } },
    quiet: { project: { "eslint.config.mjs": "", ".prettierrc": "{}" } },
  },
  "AGENTS.md above the ceiling": {
    check: "instructions.size",
    status: "warn",
    fire: { project: { "AGENTS.md": `${LONG}\n` } },
    quiet: { project: { "AGENTS.md": "# Rules\n- Keep it short.\n" } },
  },
  "rule duplicated across instruction files": {
    check: "instructions.duplicated",
    status: "warn",
    fire: { project: { "AGENTS.md": SHARED, ".claude/rules/testing.md": `# Tests\n${SHARED}` } },
    quiet: {
      project: {
        "AGENTS.md": SHARED,
        ".claude/rules/testing.md": "# Tests\n- Use node:test for every new test file.\n",
      },
    },
  },
  "auth variables in the shell": {
    check: "auth.env",
    status: "warn",
    fire: { env: { ANTHROPIC_API_KEY: "placeholder-not-a-key", ANTHROPIC_BASE_URL: "http://localhost:4000" } },
    quiet: { env: { ANTHROPIC_MODEL: "claude-test" } },
  },
};

const syncedFire = (): readonly CheckFinding[] =>
  runChecks({ ...machine(), cwd: toAbsolutePath("/home/ana/Dropbox/project") }).filter(
    (finding) => finding.check === "path.synced",
  );

describe("doctor environment checks", () => {
  for (const [name, item] of Object.entries(CASES)) {
    it(`${name} fires`, () => {
      const findings = item.check === "path.synced" ? syncedFire() : firing(item.fire, item.check);
      const first = findings.at(0);
      assert.equal(first?.status, item.status, JSON.stringify(findings));
      assert.ok(first.fixKey !== undefined, "every firing item carries a fix");
    });
    it(`${name} stays quiet`, () => {
      assert.deepEqual(firing(item.quiet, item.check), []);
    });
  }

  it("a healthy project fires nothing", () => {
    assert.deepEqual(runChecks(machine()).filter(NOT_OK), []);
  });

  it("never prints the value of an auth variable", () => {
    const ctx = fakeCtx();
    const report = buildReport(ctx, runChecks(machine(CASES["auth variables in the shell"]?.fire)));
    assert.doesNotMatch(JSON.stringify(report), /placeholder-not-a-key|localhost:4000/);
  });

  it("exits non-zero when any item fails", () => {
    const ctx = fakeCtx();
    const failing = machine(CASES["disableAllHooks"]?.fire);
    const result = doctorResult(ctx, buildReport(ctx, runChecks(failing)));
    assert.equal(result.exitCode, 1);
  });

  it("has every message and fix in en, pt-BR and es", () => {
    const keys = Object.values(CASES)
      .flatMap((item) => (item.check === "path.synced" ? syncedFire() : firing(item.fire, item.check)))
      .flatMap((finding) => [finding.messageKey, ...(finding.fixKey === undefined ? [] : [finding.fixKey])]);
    for (const lang of LANGUAGES) {
      for (const key of keys) assert.ok(catalogs[lang][key].length > 0, `${lang}: ${key}`);
    }
  });

  it("no doctor module reaches the network", () => {
    const dir = join(ROOT, "src", "doctor");
    for (const name of readdirSync(dir)) {
      const text = readFileSync(join(dir, name), "utf8");
      assert.doesNotMatch(text, /node:(https?|net|tls|dns|dgram|http2)|\bfetch\(|WebSocket/, name);
    }
  });
});
