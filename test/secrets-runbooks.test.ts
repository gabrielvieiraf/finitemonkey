import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import { run } from "../src/core/run.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { recordIncident } from "../src/secrets/incidents.js";
import { RUNBOOK_SECTIONS, runbookProblems } from "../src/secrets/runbook-check.js";
import { RUNBOOK_PROVIDERS, runbookLink, runbookProvider } from "../src/secrets/runbooks.js";
import { SAMPLES } from "./secret-samples.js";
import {
  cliJson,
  execResult,
  fakeRuntime,
  field,
  reasonText,
  ROOT as REPO,
  stdinFrom,
  TEST_VERSION,
} from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const RUNBOOKS = join(REPO, "runbooks");
const FIXTURES = join(REPO, "test", "fixtures", "runbooks");
const TODAY = "2026-10-26T12:00:00.000Z";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const accessedDates = (text: string): readonly string[] =>
  [...text.matchAll(/\(accessed (\d{4}-\d{2}-\d{2})\)/g)].map((match) => match[1] ?? "");

describe("provider runbooks", () => {
  it("every provider has a runbook with the six steps in order and a dated official source", () => {
    const present = readdirSync(RUNBOOKS).filter((name) => name.endsWith(".md"));
    assert.deepEqual([...present].sort(), RUNBOOK_PROVIDERS.map((provider) => `${provider}.md`).sort());
    for (const name of present) {
      const text = readFileSync(join(RUNBOOKS, name), "utf8");
      const newest = [...accessedDates(text)].sort().at(-1) ?? "";
      assert.deepEqual(runbookProblems(text, `${newest}T00:00:00Z`), [], name);
    }
  });

  it("a source read more than 90 days ago fails the check", () => {
    const problems = runbookProblems(readFileSync(join(FIXTURES, "stale-source.md"), "utf8"), TODAY);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /accessed 147 days ago \(limit 90\)/);
  });

  it("steps out of order fail the check", () => {
    const problems = runbookProblems(readFileSync(join(FIXTURES, "wrong-order.md"), "utf8"), TODAY);
    assert.deepEqual(problems, [`sections must be, in order: ${RUNBOOK_SECTIONS.join(" | ")}`]);
  });

  it("a runbook without a source fails the check", () => {
    const text = `${RUNBOOK_SECTIONS.join("\n\ntext\n\n")}\n`;
    assert.deepEqual(runbookProblems(text, TODAY), ["at least one official source is required under ## Sources"]);
  });

  it("maps each detected provider to its runbook and the rest to the generic one", () => {
    assert.equal(runbookProvider("aws-secret-access-key"), "aws");
    assert.equal(runbookProvider("github-fine-grained-pat"), "github");
    assert.equal(runbookProvider("asaas-api-key"), "asaas");
    assert.equal(runbookProvider("credential-in-url"), "database");
    assert.equal(runbookProvider("jwt"), "generic");
  });

  it("links the packaged file when it exists and the repository page otherwise", () => {
    const packaged = fakeRuntime({
      files: { [toAbsolutePath("/opt/fm/runbooks/stripe.md")]: "# x\n" },
      selfPath: toAbsolutePath("/opt/fm/dist/finitemonkey.mjs"),
    });
    assert.equal(runbookLink(packaged, "stripe-access-token"), toAbsolutePath("/opt/fm/runbooks/stripe.md"));
    assert.match(
      runbookLink(fakeRuntime(), "stripe-access-token"),
      /^https:\/\/github\.com\/.+\/runbooks\/stripe\.md$/,
    );
  });
});

describe("secrets incident links the runbook", () => {
  it("lists the runbook for the detected provider in text and JSON", async () => {
    const runtime = fakeRuntime();
    for (const [rule, fingerprint] of [
      ["github-pat", "00000000000000aa"],
      ["jwt", "00000000000000bb"],
    ] as const)
      recordIncident(runtime, ROOT, { rule, fingerprint, where: "src/a.ts:1", source: "scan", state: "aberto" }, "fm");
    const listed = await cliJson(["secrets", "incident"], { runtime, cwd: ROOT });
    const incidents = field(listed.body, "data", "incidents");
    const links = Array.isArray(incidents) ? incidents.map((item) => String(field(item, "runbook"))) : [];
    assert.deepEqual(links.map((link) => link.split("/").at(-1)).sort(), ["generic.md", "github.md"]);
  });
});

interface LiveRun {
  readonly code: number;
  readonly events: readonly string[];
  readonly requests: readonly ExecRequest[];
  readonly stdout: string;
}

const live = async (
  argv: readonly string[],
  stdin: TextSource,
  env: Readonly<Record<string, string>> = {},
): Promise<LiveRun> => {
  const events: string[] = [];
  const requests: ExecRequest[] = [];
  const out: string[] = [];
  const runtime: Runtime = fakeRuntime({
    exec: (request) => {
      events.push("exec");
      requests.push(request);
      return execResult(0, '{"ok":true}\n200');
    },
  });
  const code = await run({
    argv,
    env,
    cwd: ROOT,
    platform: "linux",
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => events.push(`stderr:${chunk}`) },
      stdin,
    },
    version: TEST_VERSION,
    runtime,
  });
  return { code, events, requests, stdout: out.join("") };
};

describe("optional live-key check", () => {
  const key = SAMPLES.githubPat;

  it("is off by default: without --send it only names the host", async () => {
    const result = await live(["secrets", "live", "github", "--env", "GH_TOKEN"], tty(), { GH_TOKEN: key });
    assert.equal(result.code, 0);
    assert.deepEqual(result.requests, []);
    assert.match(result.stdout, /Nothing was sent.*api\.github\.com/);
  });

  it("prints the host before sending and passes the key on stdin, never as an argument", async () => {
    const result = await live(["secrets", "live", "github", "--env", "GH_TOKEN", "--send"], tty(), { GH_TOKEN: key });
    assert.equal(result.code, 0);
    assert.match(result.events[0] ?? "", /^stderr:Contacting api\.github\.com/);
    assert.equal(result.events[1], "exec");
    const [request] = result.requests;
    assert.ok(request !== undefined);
    assert.equal(request.command, "curl");
    assert.ok(!request.args.join(" ").includes(key));
    assert.match(request.input ?? "", /^Authorization: Bearer /);
    assert.match(result.stdout, /still works at api\.github\.com \(HTTP 200\)/);
    assert.ok(!`${result.stdout}${result.events.join("")}`.includes(key));
  });

  it("refuses to send outside the person's terminal (inside Claude Code or without a TTY)", async () => {
    const argv = ["secrets", "live", "github", "--env", "GH_TOKEN", "--send"];
    const noTty = await live(argv, Readable.from([]), { GH_TOKEN: key });
    const inClaude = await live(argv, tty(), { GH_TOKEN: key, CLAUDECODE: "1" });
    for (const result of [noTty, inClaude]) {
      assert.equal(result.code, 4);
      assert.deepEqual(result.requests, []);
    }
  });

  it("never runs from a hook: the agent's Bash call is blocked", async () => {
    const runtime = fakeRuntime();
    const outcome = await runHook("PreToolUse", {
      stdin: stdinFrom(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "s1",
          cwd: ROOT,
          tool_name: "Bash",
          tool_input: { command: "npx finitemonkey secrets live github --env GH_TOKEN --send" },
        }),
      ),
      deadlineMs: 2000,
      handlers: DEFAULT_HANDLERS,
      cwd: ROOT,
      t: createTranslator("en"),
      startTimer: runtime.startTimer,
      runtime,
    });
    assert.equal(outcome.verdict, "block");
    assert.match(reasonText(outcome), /decision for the person/);
  });

  it("never runs from a hook: only the command module imports the live check", () => {
    const importers = (dir: string): readonly string[] =>
      readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((name) => name.endsWith(".ts"))
        .filter((name) => /secrets\/live\.js|\.\/live\.js/.test(readFileSync(join(dir, name), "utf8")))
        .map((name) => name.split("\\").join("/"));
    assert.deepEqual(importers(join(REPO, "src")), ["commands/secrets-live.ts"]);
  });
});
