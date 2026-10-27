import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { FOOTPRINT } from "../src/core/footprint.js";
import type { ExecRequest, ExecResult, Runtime } from "../src/core/runtime.js";
import { packagesInCommand } from "../src/deps/install-command.js";
import { closePopular } from "../src/deps/popular.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { execMissing, execResult, fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const NOW = "2026-10-27T12:00:00.000Z";
const OLD = "2019-01-01T00:00:00.000Z";
const LAST_WEEK = "2026-10-20T00:00:00.000Z";

const npmDoc = (versions: Readonly<Record<string, { readonly time: string; readonly postinstall?: boolean }>>) => {
  const names = Object.keys(versions);
  return JSON.stringify({
    name: "pkg",
    "dist-tags": { latest: names.at(-1) },
    time: { created: versions[names[0] ?? ""]?.time, ...Object.fromEntries(names.map((v) => [v, versions[v]?.time])) },
    versions: Object.fromEntries(
      names.map((v) => [
        v,
        { version: v, scripts: versions[v]?.postinstall === true ? { postinstall: "node x.js" } : {} },
      ]),
    ),
  });
};

const answer = (body: string, status: number): ExecResult => execResult(0, `${body}\n${String(status)}`);

const registry =
  (responses: Readonly<Record<string, ExecResult>>, calls: ExecRequest[] = []) =>
  (request: ExecRequest): ExecResult | undefined => {
    calls.push(request);
    const url = request.args.at(-1) ?? "";
    return Object.entries(responses).find(([suffix]) => url.endsWith(suffix))?.[1] ?? answer("{}", 404);
  };

const fire = (command: string, runtime: Runtime, env: Readonly<Record<string, string>> = {}): Promise<HookOutcome> =>
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
    env,
  });

const context = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

describe("deps guard: install commands", () => {
  it("finds new packages in npm, pnpm, yarn, bun, pip and uv commands", () => {
    const names = (command: string): readonly string[] => packagesInCommand(command).map((pkg) => pkg.name);
    assert.deepEqual(names("npm i -D left-pad @scope/thing@1.2.3"), ["left-pad", "@scope/thing"]);
    assert.deepEqual(names("pnpm add zod && yarn add react@^18 && bun add hono"), ["zod", "react", "hono"]);
    assert.deepEqual(names("pip install 'Flask==3.0.0' -r requirements.txt"), ["flask"]);
    assert.deepEqual(names("python3 -m pip install requests_toolbelt"), ["requests-toolbelt"]);
    assert.deepEqual(names("uv add httpx --group dev"), ["httpx"]);
    assert.deepEqual(names("npm install"), []);
    assert.deepEqual(names("npm i ./local file:../x git+https://x/y.git"), []);
    assert.equal(packagesInCommand("pip install Flask==3.0.0")[0]?.version, "3.0.0");
  });

  it("flags a name close to a popular package and leaves the real one alone", () => {
    assert.equal(closePopular("npm", "expresss"), "express");
    assert.equal(closePopular("pypi", "reqeusts"), "requests");
    assert.equal(closePopular("npm", "express"), undefined);
    assert.equal(closePopular("npm", "left-pad"), undefined);
  });
});

describe("deps guard: registry checks warn and never block", () => {
  it("warns that a nonexistent package does not exist", async () => {
    const runtime = fakeRuntime({ now: NOW, exec: registry({}) });
    const outcome = await fire("npm i totally-invented-helper-lib", runtime);
    assert.equal(outcome.verdict, "allow");
    assert.match(context(outcome), /totally-invented-helper-lib does not exist on registry\.npmjs\.org/);
  });

  it("warns about a typo of a popular package", async () => {
    const doc = npmDoc({ "1.0.0": { time: OLD }, "1.0.1": { time: OLD }, "1.0.2": { time: OLD } });
    const runtime = fakeRuntime({ now: NOW, exec: registry({ "/expresss": answer(doc, 200) }) });
    const outcome = await fire("npm install expresss", runtime);
    assert.equal(outcome.verdict, "allow");
    assert.match(context(outcome), /expresss is one or two letters away from the popular package express/);
  });

  it("warns when the new version brings an install script the previous one did not have", async () => {
    const doc = npmDoc({
      "2.0.0": { time: OLD },
      "2.0.1": { time: OLD },
      "2.1.0": { time: LAST_WEEK, postinstall: true },
    });
    const runtime = fakeRuntime({ now: NOW, exec: registry({ "/tiny-colors": answer(doc, 200) }) });
    const outcome = await fire("pnpm add tiny-colors", runtime);
    assert.equal(outcome.verdict, "allow");
    assert.match(context(outcome), /tiny-colors@2\.1\.0 adds an install script/);
  });

  it("warns about a package with little history and a version published hours ago", async () => {
    const doc = npmDoc({ "0.0.1": { time: "2026-10-27T06:00:00.000Z" } });
    const runtime = fakeRuntime({ now: NOW, exec: registry({ "/brand-new-sdk": answer(doc, 200) }) });
    const text = context(await fire("npm i brand-new-sdk", runtime));
    assert.match(text, /brand-new-sdk has little history: first published 0 days ago, 1 version\./);
    assert.match(text, /brand-new-sdk@0\.0\.1 was published 6 hours ago/);
  });

  it("checks PyPI for pip and uv", async () => {
    const doc = JSON.stringify({
      info: { version: "2.0.0" },
      releases: {
        "1.0.0": [{ upload_time_iso_8601: OLD }],
        "2.0.0": [{ upload_time_iso_8601: "2026-10-27T10:00:00Z" }],
      },
    });
    const runtime = fakeRuntime({ now: NOW, exec: registry({ "/pypi/fastjsonx/json": answer(doc, 200) }) });
    assert.match(context(await fire("uv add fastjsonx", runtime)), /fastjsonx@2\.0\.0 was published 2 hours ago/);
  });

  it("stays silent for a well-known package and for packages the project already declares", async () => {
    const doc = npmDoc({ "1.0.0": { time: OLD }, "1.1.0": { time: OLD }, "1.2.0": { time: OLD } });
    const calls: ExecRequest[] = [];
    const files = { [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { "left-pad": "1.0.0" } }) };
    const runtime = fakeRuntime({ now: NOW, files, exec: registry({ "/zod": answer(doc, 200) }, calls) });
    assert.equal(context(await fire("npm i zod left-pad", runtime)), "");
    assert.deepEqual(
      calls.map((call) => call.args.at(-1)),
      ["https://registry.npmjs.org/zod"],
    );
  });
});

describe("deps guard: offline", () => {
  it("makes no request with FINITEMONKEY_OFFLINE and keeps the local spelling check", async () => {
    const calls: ExecRequest[] = [];
    const runtime = fakeRuntime({ now: NOW, exec: registry({}, calls) });
    const outcome = await fire("npm i expresss", runtime, { FINITEMONKEY_OFFLINE: "1" });
    assert.equal(outcome.verdict, "allow");
    assert.deepEqual(calls, []);
    assert.match(context(outcome), /popular package express/);
    assert.match(context(outcome), /expresss was not checked on registry\.npmjs\.org/);
  });

  it("degrades to a local warning when curl is missing or the network is down", async () => {
    for (const result of [execMissing, execResult(6, "", "Could not resolve host")]) {
      const outcome = await fire("npm i some-lib", fakeRuntime({ now: NOW, exec: () => result }));
      assert.equal(outcome.verdict, "allow");
      assert.match(context(outcome), /some-lib was not checked on registry\.npmjs\.org \(offline/);
    }
  });

  it("is listed in the sends section of the footprint", () => {
    const sends = FOOTPRINT.filter((entry) => entry.kind === "sends").map((entry) => entry.id);
    assert.ok(sends.includes("deps-registry"));
    const entry = FOOTPRINT.find((item) => item.id === "deps-registry");
    assert.deepEqual(entry?.targets, ["registry.npmjs.org", "pypi.org"]);
  });
});
