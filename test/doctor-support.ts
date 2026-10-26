import { join } from "node:path";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest, ExecResult, GitResult, ProbeResult, Runtime } from "../src/core/runtime.js";
import { runChecks } from "../src/doctor/run.js";
import type { CheckFinding, DoctorEnv } from "../src/doctor/types.js";
import { hookHandler, INSTALLED_HOOKS } from "../src/install/hook-entries.js";
import { pluginHooks } from "../src/install/plugin-hooks.js";
import { execResult, fakeRuntime, found, TEST_VERSION } from "./support.js";

export const PROJECT = "/home/ana/project";
export const USER_SETTINGS = "/home/test/.claude/settings.json";
export const MANAGED = "/etc/claude-code/managed-settings.json";
export const PLUGIN_ROOT = "/home/test/.claude/plugins/cache/finitemonkey/finitemonkey/9.9.9-test";
export const PLUGIN_INDEX = "/home/test/.claude/plugins/installed_plugins.json";

export interface Fixture {
  readonly platform?: NodeJS.Platform;
  readonly nodeVersion?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly project?: Readonly<Record<string, string | undefined>>;
  readonly tools?: Readonly<Record<string, ProbeResult>>;
  readonly git?: (args: readonly string[]) => GitResult;
  readonly exec?: (request: ExecRequest) => ExecResult | undefined;
  readonly execLog?: ExecRequest[];
}

export const HEALTHY_TOOLS: Readonly<Record<string, ProbeResult>> = {
  git: found("git version 2.47.1"),
  claude: found("2.1.300 (Claude Code)"),
  bwrap: found("bubblewrap 0.9.0"),
  socat: found("socat version 1.8"),
};

export const settings = (value: object): string => JSON.stringify(value);

export const installedHooks = (): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    INSTALLED_HOOKS.map((spec) => [spec.event, [{ hooks: [hookHandler({ kind: "local" }, spec, true)] }]]),
  );

export const INSTALLED_PROJECT: Readonly<Record<string, string>> = {
  ".claude/settings.json": settings({ hooks: installedHooks() }),
  ".finitemonkey/lock.json": "{}",
};

export const pluginFiles = (
  enabled: boolean,
  hooks: string = JSON.stringify(pluginHooks()),
): Record<string, string> => ({
  [PLUGIN_INDEX]: settings({
    version: 2,
    plugins: { "finitemonkey@finitemonkey": [{ scope: "user", installPath: PLUGIN_ROOT, version: TEST_VERSION }] },
  }),
  [`${PLUGIN_ROOT}/.claude-plugin/plugin.json`]: settings({ name: "finitemonkey", version: TEST_VERSION }),
  [`${PLUGIN_ROOT}/hooks/hooks.json`]: hooks,
  [USER_SETTINGS]: settings({ enabledPlugins: { "finitemonkey@finitemonkey": enabled } }),
});

export const versionAnswer = (version: string): ExecResult =>
  execResult(0, JSON.stringify({ schemaVersion: 1, ok: true, command: "version", data: { version } }));

export const healthyExec = (request: ExecRequest): ExecResult => {
  if (request.args.includes("version") || request.command.includes(" version ")) return versionAnswer(TEST_VERSION);
  return execResult(0, '{"continue":true}\n');
};

const projectPath = (relative: string): string => toAbsolutePath(join(PROJECT, ...relative.split("/")));

const seed = (fixture: Fixture): Readonly<Record<string, string>> => {
  const project = { ...INSTALLED_PROJECT, ...fixture.project };
  return Object.fromEntries([
    [toAbsolutePath("/proc/version"), "Linux version 6.8.0-generic"] as const,
    ...Object.entries(fixture.files ?? {}).map(([path, text]) => [toAbsolutePath(path), text] as const),
    ...Object.entries(project).flatMap(([path, text]) =>
      text === undefined ? [] : [[projectPath(path), text] as const],
    ),
  ]);
};

export const runtimeFor = (fixture: Fixture = {}): Runtime =>
  fakeRuntime({
    nodeVersion: fixture.nodeVersion ?? "22.11.0",
    tools: { ...HEALTHY_TOOLS, ...fixture.tools },
    files: seed(fixture),
    exec: (request) => {
      fixture.execLog?.push(request);
      return fixture.exec?.(request) ?? healthyExec(request);
    },
    ...(fixture.git === undefined ? {} : { git: fixture.git }),
  });

export const machine = (fixture: Fixture = {}): DoctorEnv => ({
  platform: fixture.platform ?? "linux",
  env: { PATH: "/usr/local/bin:/usr/bin", ...fixture.env },
  cwd: toAbsolutePath(PROJECT),
  root: toAbsolutePath(PROJECT),
  version: TEST_VERSION,
  runtime: runtimeFor(fixture),
});

export const NOT_OK = (finding: CheckFinding): boolean => finding.status !== "ok";

export const firing = (fixture: Fixture, check: string): readonly CheckFinding[] =>
  runChecks(machine(fixture)).filter((finding) => finding.check === check && NOT_OK(finding));
