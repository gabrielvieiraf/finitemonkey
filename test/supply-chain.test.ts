import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest, ExecResult, GitResult, Runtime } from "../src/core/runtime.js";
import { checkSupplyChain } from "../src/doctor/supply-chain.js";
import { HOOK_EVENTS } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { memoryFs } from "./memory-fs.js";
import { BUNDLE, BUNDLE_TEXT, cliJson, execMissing, execResult, fakeRuntime, field, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (path: string): string => toAbsolutePath(path, ROOT);
const NOW = "2026-10-27T12:00:00.000Z";

const repo = (
  files: Readonly<Record<string, string>>,
  exec?: (request: ExecRequest) => ExecResult | undefined,
): { readonly runtime: Runtime; readonly read: (path: string) => string | undefined } => {
  const fs = memoryFs(
    { [BUNDLE]: BUNDLE_TEXT, ...Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])) },
    [],
    NOW,
  );
  const git = (args: readonly string[]): GitResult => {
    if (args[0] === "rev-parse") return { found: true, ok: true, stdout: `${ROOT}\n` };
    if (args[0] === "ls-files") return { found: true, ok: true, stdout: `${Object.keys(files).join("\n")}\n` };
    return { found: true, ok: false, stdout: "" };
  };
  return {
    runtime: fakeRuntime({ fs, git, now: NOW, ...(exec === undefined ? {} : { exec }) }),
    read: (p) => fs.read(at(p)),
  };
};

const doctor = (runtime: Runtime) =>
  checkSupplyChain({ platform: "linux", env: {}, cwd: ROOT, root: ROOT, version: "1.0.0", runtime });

describe("supply chain: one lockfile per ecosystem", () => {
  const files = {
    "package.json": "{}",
    "package-lock.json": "{}",
    "yarn.lock": "",
    "apps/web/pnpm-lock.yaml": "",
    "svc/poetry.lock": "",
    "svc/uv.lock": "",
  };

  it("deps check fails with each directory that has two lockfiles for the same ecosystem", async () => {
    const result = await cliJson(["deps", "check"], { cwd: ROOT, runtime: repo(files).runtime });
    assert.equal(result.code, 1);
    assert.equal(field(result.body, "error", "code"), "deps_check_failed");
    assert.deepEqual(field(result.body, "data", "lockfiles"), [
      { dir: "", ecosystem: "javascript", files: ["package-lock.json", "yarn.lock"] },
      { dir: "svc", ecosystem: "python", files: ["svc/poetry.lock", "svc/uv.lock"] },
    ]);
  });

  it("doctor fails on the same repository", () => {
    const found = doctor(repo(files).runtime);
    assert.deepEqual(
      found.map((item) => [item.check, item.status]),
      [
        ["supply.lockfiles", "fail"],
        ["supply.lockfiles", "fail"],
      ],
    );
  });

  it("passes with one lockfile per ecosystem", async () => {
    const clean = { "package-lock.json": "{}", "apps/web/pnpm-lock.yaml": "", "svc/uv.lock": "" };
    const result = await cliJson(["deps", "check"], { cwd: ROOT, runtime: repo(clean).runtime });
    assert.equal(result.code, 0);
    assert.deepEqual(doctor(repo(clean).runtime), []);
  });
});

describe("supply chain: frozen installs in CI and Dockerfiles", () => {
  const workflow = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - run: npm install -g pnpm",
    "      - run: npm install",
    "      - run: npm ci",
    "      - run: pnpm install --frozen-lockfile",
    "      - run: pnpm install && pnpm test",
    "      # - run: yarn install",
    "      - run: yarn install --immutable",
    "",
  ].join("\n");
  const dockerfile = ["FROM python:3.12", "RUN uv sync --locked", "RUN uv sync", "RUN bun install", ""].join("\n");

  it("lists each install that ignores the lockfile with file, line and the frozen command", async () => {
    const files = { ".github/workflows/ci.yml": workflow, Dockerfile: dockerfile, "README.md": "run npm install" };
    const result = await cliJson(["deps", "check"], { cwd: ROOT, runtime: repo(files).runtime });
    assert.equal(result.code, 1);
    assert.deepEqual(field(result.body, "data", "installs"), [
      { file: ".github/workflows/ci.yml", line: 5, command: "npm install", fix: "npm ci" },
      { file: ".github/workflows/ci.yml", line: 8, command: "pnpm install", fix: "pnpm install --frozen-lockfile" },
      { file: "Dockerfile", line: 3, command: "uv sync", fix: "uv sync --locked" },
      { file: "Dockerfile", line: 4, command: "bun install", fix: "bun install --frozen-lockfile" },
    ]);
    assert.deepEqual(
      doctor(repo(files).runtime).map((item) => item.check),
      ["supply.frozen", "supply.frozen", "supply.frozen", "supply.frozen"],
    );
  });
});

const osvReport = JSON.stringify({
  results: [
    {
      source: { path: "/home/ana/project/package-lock.json", type: "lockfile" },
      packages: [
        {
          package: { name: "lodash", version: "4.17.20", ecosystem: "npm" },
          vulnerabilities: [
            {
              id: "GHSA-aaaa-bbbb-cccc",
              affected: [
                { package: { name: "lodash" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] },
              ],
            },
          ],
          groups: [{ ids: ["GHSA-aaaa-bbbb-cccc"], max_severity: "9.8" }],
        },
        {
          package: { name: "left-pad", version: "1.0.0", ecosystem: "npm" },
          vulnerabilities: [{ id: "GHSA-dddd-eeee-ffff", database_specific: { severity: "HIGH" }, affected: [] }],
          groups: [{ ids: ["GHSA-dddd-eeee-ffff"] }],
        },
      ],
    },
  ],
});

describe("supply chain: osv-scanner in CI", () => {
  const scanner =
    (stdout: string, calls: ExecRequest[] = []) =>
    (request: ExecRequest): ExecResult | undefined => {
      calls.push(request);
      return request.command === "osv-scanner" ? execResult(1, stdout) : undefined;
    };

  it("blocks a critical with a fix and warns the rest with a deadline", async () => {
    const { runtime, read } = repo({ "package-lock.json": "{}" }, scanner(osvReport));
    const result = await cliJson(["deps", "scan"], { cwd: ROOT, runtime });
    assert.equal(result.code, 1);
    assert.equal(field(result.body, "error", "code"), "deps_vulnerable");
    const vulns = field(result.body, "data", "vulnerabilities");
    assert.ok(Array.isArray(vulns));
    assert.deepEqual(
      vulns.map((vuln: unknown) => [field(vuln, "id"), field(vuln, "severity"), field(vuln, "verdict")]),
      [
        ["GHSA-aaaa-bbbb-cccc", "critical", "block"],
        ["GHSA-dddd-eeee-ffff", "high", "warn"],
      ],
    );
    assert.equal(field(vulns[1], "deadline"), "2026-11-10T12:00:00.000Z");
    assert.match(read(".finitemonkey/findings/osv.json") ?? "", /left-pad@1\.0\.0\/GHSA-dddd-eeee-ffff": "2026-10-27/);
  });

  it("blocks a warning again once its deadline has passed", async () => {
    const seen = {
      ".finitemonkey/findings/osv.json": JSON.stringify({
        firstSeen: { "npm/left-pad@1.0.0/GHSA-dddd-eeee-ffff": "2026-09-01T00:00:00.000Z" },
      }),
    };
    const onlyHigh = JSON.parse(osvReport) as { results: { packages: unknown[] }[] };
    const first = onlyHigh.results[0];
    assert.ok(first !== undefined);
    first.packages = first.packages.slice(1);
    const { runtime } = repo({ "package-lock.json": "{}", ...seen }, scanner(JSON.stringify(onlyHigh)));
    const result = await cliJson(["deps", "scan"], { cwd: ROOT, runtime });
    assert.equal(result.code, 1);
    assert.equal(field(result.body, "data", "blocking"), 1);
  });

  it("passes with no vulnerabilities and says when osv-scanner is missing", async () => {
    const clean = await cliJson(["deps", "scan"], {
      cwd: ROOT,
      runtime: repo({}, scanner('{"results":[]}')).runtime,
    });
    assert.equal(clean.code, 0);
    const missing = await cliJson(["deps", "scan"], { cwd: ROOT, runtime: repo({}, () => execMissing).runtime });
    assert.equal(missing.code, 3);
    assert.equal(field(missing.body, "error", "code"), "deps_scanner_missing");
  });

  it("never runs from a hook", async () => {
    const calls: ExecRequest[] = [];
    const { runtime } = repo({ "package-lock.json": "{}", "yarn.lock": "" }, scanner(osvReport, calls));
    for (const event of HOOK_EVENTS) {
      await runHook(event, {
        stdin: stdinFrom(
          JSON.stringify({
            hook_event_name: event,
            session_id: "s1",
            cwd: ROOT,
            tool_name: "Bash",
            tool_input: { command: "npm ci && npm audit" },
            prompt: "scan the dependencies",
          }),
        ),
        deadlineMs: 5000,
        handlers: DEFAULT_HANDLERS,
        cwd: ROOT,
        t: createTranslator("en"),
        startTimer: runtime.startTimer,
        runtime,
      });
    }
    assert.deepEqual(
      calls.filter((call) => call.command === "osv-scanner"),
      [],
    );
  });
});

describe("supply chain: update bot config", () => {
  const files = {
    "package.json": "{}",
    "svc/pyproject.toml": "",
    "svc/uv.lock": "",
    Dockerfile: "FROM node:22",
    ".github/workflows/ci.yml": "jobs: {}",
  };

  it("prints a Dependabot config with grouping and a cooldown, and writes nothing without --write", async () => {
    const { runtime, read } = repo(files);
    const result = await cliJson(["deps", "config"], { cwd: ROOT, runtime });
    assert.equal(result.code, 0);
    const text = String(field(result.body, "data", "text"));
    for (const ecosystem of ["docker", "github-actions", "npm", "uv"])
      assert.match(text, new RegExp(`package-ecosystem: ${ecosystem}`));
    assert.match(text, /default-days: 7/);
    assert.match(text, /minor-and-patch:/);
    assert.match(text, /- "\/svc"/);
    assert.equal(read(".github/dependabot.yml"), undefined);
  });

  it("writes the file with --write, and Renovate with --renovate", async () => {
    const { runtime, read } = repo(files);
    assert.equal((await cliJson(["deps", "config", "--write"], { cwd: ROOT, runtime })).code, 0);
    assert.match(read(".github/dependabot.yml") ?? "", /^version: 2\n/);
    assert.equal((await cliJson(["deps", "config", "--renovate", "--write"], { cwd: ROOT, runtime })).code, 0);
    assert.match(read("renovate.json") ?? "", /"minimumReleaseAge": "7 days"/);
  });
});
