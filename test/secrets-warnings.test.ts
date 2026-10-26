import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { GitResult, Runtime } from "../src/core/runtime.js";
import { checkRemoteCredentials } from "../src/doctor/remotes.js";
import { secretsCheck } from "../src/gate/checks/secrets.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { secretsSessionStart } from "../src/secrets/guards/session.js";
import { remotesWithCredentials } from "../src/secrets/remotes.js";
import { fmPaths } from "../src/task/paths.js";
import { git, hook, tempRepo } from "./git-support.js";
import { SAMPLES } from "./secret-samples.js";
import { cliJson, fakeRuntime, field, gitMissing, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const t = createTranslator("en");
const ARG_LINE = `    command: redis-server --requirepass ${SAMPLES.argValue}`;
const TOKEN = SAMPLES.githubPat.slice(4);

const writeHook = (path: string, content: string, runtime: Runtime = fakeRuntime()) =>
  runHook("PreToolUse", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        cwd: ROOT,
        tool_name: "Write",
        tool_input: { file_path: `${ROOT}/${path}`, content },
      }),
    ),
    deadlineMs: 2000,
    handlers: DEFAULT_HANDLERS,
    cwd: ROOT,
    t,
    startTimer: runtime.startTimer,
    runtime,
  });

describe("warning rules do not block a write", () => {
  it("a password in compose arguments is written and reported as context", async () => {
    const outcome = await writeHook("compose.yaml", `services:\n  cache:\n${ARG_LINE}\n`);
    assert.equal(outcome.verdict, "allow", outcome.stderr);
    assert.match(outcome.stdout, /secret-in-process-args at compose\.yaml:3/);
    assert.ok(!outcome.stdout.includes(SAMPLES.argValue));
  });

  it("disabled TLS in production code is written with a warning", async () => {
    const outcome = await writeHook("src/db.ts", 'export const url = "postgres://db/app?sslmode=disable";\n');
    assert.equal(outcome.verdict, "allow", outcome.stderr);
    assert.match(outcome.stdout, /tls-disabled at src\/db\.ts:1/);
  });

  it("a credential next to a warning still blocks", async () => {
    const outcome = await writeHook("compose.yaml", `${ARG_LINE}\nTOKEN=${SAMPLES.githubPat}\n`);
    assert.equal(outcome.verdict, "block");
    assert.match(outcome.stderr, /github-pat/);
  });
});

describe("warnings do not fail secrets scan", () => {
  it("lists a warning with exit 0 and fails once a credential appears", async () => {
    const files = (extra: string): Runtime =>
      fakeRuntime({ files: { [`${ROOT}/compose.yaml`]: `services:\n  cache:\n${ARG_LINE}\n${extra}` } });
    const warned = await cliJson(["secrets", "scan"], { runtime: files(""), cwd: ROOT });
    assert.equal(warned.code, 0);
    assert.equal(field(warned.body, "data", "summary", "total"), 1);
    assert.ok(!warned.stdout.includes(SAMPLES.argValue));
    const failing = await cliJson(["secrets", "scan"], { runtime: files(`TOKEN=${SAMPLES.githubPat}\n`), cwd: ROOT });
    assert.equal(failing.code, 1);
  });
});

const diffOf = (lines: readonly string[]): string =>
  [
    "diff --git a/compose.yaml b/compose.yaml",
    "--- a/compose.yaml",
    "+++ b/compose.yaml",
    "@@ -0,0 +1 @@",
    ...lines,
  ].join("\n");

const gateWith = (diff: string): ReturnType<typeof secretsCheck> => {
  const git = (args: readonly string[]): GitResult => {
    if (args[0] === "diff") return { found: true, ok: true, stdout: diff };
    if (args[0] === "ls-files") return { found: true, ok: true, stdout: "" };
    return gitMissing;
  };
  const runtime = fakeRuntime({ git });
  return secretsCheck({ id: "secrets", kind: "secrets" }, { runtime, paths: fmPaths(ROOT) });
};

describe("warnings appear in the gate report", () => {
  it("passes with a warning note for a warning-only change", () => {
    const outcome = gateWith(diffOf([`+${ARG_LINE}`]));
    assert.equal(outcome.status, "passed");
    assert.deepEqual(
      outcome.notes.map((entry) => entry.key),
      ["gate.secrets.warning"],
    );
  });

  it("fails on a credential and still lists the warning", () => {
    const outcome = gateWith(diffOf([`+${ARG_LINE}`, `+TOKEN=${SAMPLES.githubPat}`]));
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      outcome.notes.map((entry) => entry.key),
      ["gate.secrets.finding", "gate.secrets.warning"],
    );
  });
});

const remoteOutput = [
  `origin\thttps://ana:${TOKEN}@github.com/acme/app.git (fetch)`,
  `origin\thttps://ana:${TOKEN}@github.com/acme/app.git (push)`,
  "upstream\thttps://github.com/acme/app.git (fetch)",
  "upstream\thttps://github.com/acme/app.git (push)",
  `mirror\thttps://${SAMPLES.githubPat}@github.com/acme/app.git (fetch)`,
  "ssh\tgit@github.com:acme/app.git (fetch)",
].join("\n");

const remoteRuntime = (stdout: string): Runtime =>
  fakeRuntime({ git: (args) => (args.join(" ") === "remote -v" ? { found: true, ok: true, stdout } : gitMissing) });

describe("credentials in git remotes", () => {
  it("names the remotes with a credential and nothing else", () => {
    assert.deepEqual(remotesWithCredentials(remoteRuntime(remoteOutput), ROOT), ["mirror", "origin"]);
    assert.deepEqual(remotesWithCredentials(remoteRuntime("origin\tgit@github.com:a/b.git (fetch)"), ROOT), []);
  });

  it("doctor warns by remote name and never prints the token", () => {
    const findings = checkRemoteCredentials({
      platform: "linux",
      env: {},
      cwd: ROOT,
      root: ROOT,
      version: "1.0.0",
      runtime: remoteRuntime(remoteOutput),
    });
    assert.equal(findings.length, 1);
    const [first] = findings;
    assert.ok(first !== undefined);
    assert.equal(first.status, "warn");
    const fix = t(first.fixKey ?? "doctor.secrets.fix_remote_credential", first.params);
    const text = `${t(first.messageKey, first.params)} ${fix}`;
    assert.match(text, /mirror, origin/);
    assert.ok(!text.includes(TOKEN));
    assert.ok(!text.includes(SAMPLES.githubPat));
  });

  it("SessionStart warns about a real repository remote without printing the token", async () => {
    const repo = tempRepo();
    try {
      git(repo.root, "remote", "add", "origin", `https://ana:${TOKEN}@example.com/acme/app.git`);
      const decision = await hook(secretsSessionStart, "SessionStart", repo.root);
      const text = JSON.stringify(decision);
      assert.equal(decision.kind, "allow");
      assert.match(text, /git remote origin has a credential/);
      assert.ok(!text.includes(TOKEN));
      git(repo.root, "remote", "set-url", "origin", "https://example.com/acme/app.git");
      assert.deepEqual(await hook(secretsSessionStart, "SessionStart", repo.root), { kind: "allow" });
    } finally {
      repo.dispose();
    }
  });
});
