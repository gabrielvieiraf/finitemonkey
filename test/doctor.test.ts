import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doctorResult } from "../src/commands/doctor.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { ProbeResult } from "../src/core/runtime.js";
import { buildReport, runChecks } from "../src/doctor/run.js";
import { detectOs, type OsKind, pathTraits } from "../src/doctor/system.js";
import { parseGitVersion } from "../src/doctor/tools.js";
import type { CheckStatus, DoctorEnv } from "../src/doctor/types.js";
import { bundle, fakeCtx, fakeRuntime, field, found, missing, parseBody, slow } from "./support.js";

interface Machine {
  readonly nodeVersion?: string;
  readonly platform?: NodeJS.Platform;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly procVersion?: string;
  readonly tools?: Readonly<Record<string, ProbeResult>>;
}

const machine = (spec: Machine = {}): DoctorEnv => ({
  platform: spec.platform ?? "linux",
  env: spec.env ?? {},
  cwd: toAbsolutePath(spec.cwd ?? "/home/ana/project"),
  root: toAbsolutePath(spec.cwd ?? "/home/ana/project"),
  runtime: fakeRuntime({
    ...(spec.nodeVersion === undefined ? {} : { nodeVersion: spec.nodeVersion }),
    ...(spec.tools === undefined ? {} : { tools: spec.tools }),
    files: { [toAbsolutePath("/proc/version")]: spec.procVersion ?? "Linux version 6.8.0-generic" },
  }),
});

const statuses = (env: DoctorEnv): Readonly<Record<string, CheckStatus>> =>
  Object.fromEntries(runChecks(env).map((finding) => [finding.check, finding.status]));

const ctx = fakeCtx();

describe("doctor checks", () => {
  const cases: readonly {
    readonly name: string;
    readonly machine: Machine;
    readonly expect: Readonly<Record<string, CheckStatus>>;
  }[] = [
    {
      name: "healthy machine",
      machine: {},
      expect: { node: "ok", git: "ok", claude: "ok", os: "ok", "path.chars": "ok" },
    },
    { name: "Node 18", machine: { nodeVersion: "18.19.0" }, expect: { node: "fail" } },
    { name: "git missing", machine: { tools: { git: missing } }, expect: { git: "fail" } },
    { name: "git 2.34", machine: { tools: { git: found("git version 2.34.1") } }, expect: { git: "warn" } },
    { name: "Claude Code missing", machine: { tools: { claude: missing } }, expect: { claude: "warn" } },
    { name: "Claude Code hangs", machine: { tools: { claude: slow } }, expect: { claude: "warn" } },
    {
      name: "WSL on /mnt/c",
      machine: { procVersion: "Linux version 6.6.87.2-microsoft-standard-WSL2", cwd: "/mnt/c/Users/ana/repo" },
      expect: { os: "ok", "path.wsl_mount": "warn" },
    },
    { name: "spaces and accents", machine: { cwd: "/home/ana/Área de Trabalho/x" }, expect: { "path.chars": "warn" } },
    {
      name: "iCloud folder",
      machine: { cwd: "/Users/ana/Library/Mobile Documents/proj" },
      expect: { "path.chars": "warn", "path.synced": "warn" },
    },
  ];
  for (const { name, machine: spec, expect } of cases) {
    const posixOnly = expect["path.wsl_mount"] !== undefined && process.platform === "win32";
    it(name, { skip: posixOnly ? "a /mnt/c path does not exist on Windows" : false }, () => {
      const actual = statuses(machine(spec));
      for (const [check, status] of Object.entries(expect)) assert.equal(actual[check], status, check);
    });
  }

  const systems: readonly { readonly spec: Machine; readonly os: OsKind }[] = [
    { spec: {}, os: "linux" },
    { spec: { procVersion: "Linux version 5.15.0-microsoft-standard" }, os: "wsl" },
    { spec: { env: { WSL_DISTRO_NAME: "Ubuntu" } }, os: "wsl" },
    { spec: { platform: "darwin" }, os: "macos" },
    { spec: { platform: "win32" }, os: "windows" },
    { spec: { platform: "freebsd" }, os: "other" },
  ];
  for (const { spec, os } of systems) {
    it(`detects ${os}`, () => {
      assert.equal(detectOs(machine(spec)), os);
    });
  }

  it("reads path traits and git versions", () => {
    assert.deepEqual(pathTraits("/home/ana/Área de Trabalho"), { spaces: true, nonAscii: true, synced: false });
    assert.equal(pathTraits("C:\\Users\\ana\\OneDrive\\Documentos").synced, true);
    assert.deepEqual(parseGitVersion("git version 2.47.1.windows.2"), { major: 2, minor: 47 });
    assert.equal(parseGitVersion("nonsense"), undefined);
  });
});

describe("doctor result", () => {
  it("exits 1 with the first failing fix", () => {
    const result = doctorResult(ctx, buildReport(ctx, runChecks(machine({ nodeVersion: "18.19.0" }))));
    assert.equal(result.exitCode, 1);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "doctor_failed");
    assert.match(result.error.fix, /nodejs\.org/);
  });

  it("warnings alone still exit 0", () => {
    const result = doctorResult(
      ctx,
      buildReport(
        ctx,
        runChecks(machine({ tools: { claude: missing, bwrap: found("bubblewrap 0.9.0"), socat: found("socat 1.8") } })),
      ),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(result.ok);
    assert.equal(result.data.summary.warn, 1);
  });

  it("bundle doctor --json follows the contract on this machine", () => {
    const result = bundle(["doctor", "--json"]);
    const body = parseBody(result.stdout);
    assert.equal(field(body, "schemaVersion"), 1);
    assert.equal(field(body, "data", "schema"), "finitemonkey/doctor@1");
    assert.equal(result.code, field(body, "ok") === true ? 0 : 1);
  });
});
