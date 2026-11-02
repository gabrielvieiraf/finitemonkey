import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import { run } from "../src/core/run.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { LIVE_PROBES, sentHeaders } from "../src/secrets/live.js";
import { execResult, fakeRuntime, reasonText, stdinFrom, TEST_VERSION } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const KEY = "not-a-real-key-for-tests";
const NEW_PROVIDERS = ["mailgun", "sendgrid", "gitlab", "npm", "huggingface"] as const;

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const live = async (argv: readonly string[], stdin: TextSource, env: Readonly<Record<string, string>>) => {
  const requests: ExecRequest[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const runtime = fakeRuntime({
    exec: (request) => {
      requests.push(request);
      return execResult(0, "{}\n401");
    },
  });
  const code = await run({
    argv,
    env,
    cwd: ROOT,
    platform: "linux",
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
      stdin,
    },
    version: TEST_VERSION,
    runtime,
  });
  return { code, requests, stdout: out.join(""), stderr: err.join("") };
};

const agentBash = async (command: string) => {
  const runtime = fakeRuntime();
  return runHook("PreToolUse", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        cwd: ROOT,
        tool_name: "Bash",
        tool_input: { command },
      }),
    ),
    deadlineMs: 2000,
    handlers: DEFAULT_HANDLERS,
    cwd: ROOT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  });
};

describe("live checks for more providers", () => {
  for (const provider of NEW_PROVIDERS) {
    const probe = LIVE_PROBES[provider];
    const url = `https://${probe.host}${probe.path}`;

    it(`${provider}: without --send it says the endpoint and the headers it would send, and sends nothing`, async () => {
      const result = await live(["secrets", "live", provider, "--env", "KEY", "--json"], tty(), { KEY });
      assert.equal(result.code, 0, result.stdout);
      assert.deepEqual(result.requests, []);
      const data = (JSON.parse(result.stdout) as { data: { url: string; sends: string[]; sent: boolean } }).data;
      assert.equal(data.url, url);
      assert.equal(data.sent, false);
      assert.deepEqual(data.sends, sentHeaders(provider));
      assert.ok(data.sends.length > 0);
      assert.ok(!result.stdout.includes(KEY));
    });

    it(`${provider}: with --send it prints the endpoint and headers first, then passes the key on stdin only`, async () => {
      const result = await live(["secrets", "live", provider, "--env", "KEY", "--send"], tty(), { KEY });
      assert.match(result.stderr, new RegExp(`Contacting ${probe.host.replace(/\./g, "\\.")}`));
      assert.match(result.stderr, /It sends one GET to .* with these headers: /);
      const [request] = result.requests;
      assert.ok(request !== undefined);
      assert.ok(request.args.includes(url));
      assert.ok(!request.args.join(" ").includes(KEY));
      assert.ok((request.input ?? "").length > 0);
      assert.ok(!`${result.stdout}${result.stderr}`.includes(KEY));
      assert.match(result.stdout, /rejected the key/);
    });

    it(`${provider}: never runs from the agent`, async () => {
      const inClaude = await live(["secrets", "live", provider, "--env", "KEY", "--send"], tty(), {
        KEY,
        CLAUDECODE: "1",
      });
      assert.equal(inClaude.code, 4);
      assert.deepEqual(inClaude.requests, []);
      const outcome = await agentBash(`npx finitemonkey secrets live ${provider} --env KEY --send`);
      assert.equal(outcome.verdict, "block");
      assert.match(reasonText(outcome), /decision for the person/);
    });
  }

  it("mailgun sends the key as basic auth for the api user, not as a bearer token", () => {
    const [header = ""] = LIVE_PROBES.mailgun.headers(KEY);
    const encoded = header.replace(/^Authorization: Basic /, "");
    assert.equal(Buffer.from(encoded, "base64").toString("utf8"), `api:${KEY}`);
  });
});
