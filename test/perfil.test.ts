import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { JsonObject } from "../src/core/parsed.js";
import { headShaFromFiles } from "../src/git/head-file.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { readProfile } from "../src/perfil/store.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { BUNDLE, cli, cliJson, field, found } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const runtime = () => ({ ...repoRuntime(), probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE });

const installed = async (): Promise<Repo> => {
  const repo = makeRepo({ "README.md": "# app\n" });
  repos.push(repo);
  const init = await cliJson(["init", "--yes"], { cwd: repo.root, runtime: runtime(), version: "1.0.0" });
  assert.equal(init.code, 0, init.stdout);
  repo.commit("install finitemonkey");
  return repo;
};

const tty = (text: string) => Object.assign(Readable.from([text]), { isTTY: true });

const level = (body: JsonObject, domain: string, measure: string): unknown =>
  field(body, "data", "domains", domain, measure, "level");

const fire = (repo: Repo, event: HookEvent, payload: JsonObject) => {
  const rt = repoRuntime();
  return runHook(event, {
    stdin: Readable.from([JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: repo.root, ...payload })]),
    deadlineMs: 20_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: rt.startTimer,
    runtime: rt,
    env: {},
  });
};

describe("perfil: quick start", () => {
  it("is skipped without a TTY and everything starts at intermediate", async () => {
    const repo = await installed();
    const result = await cliJson(["perfil", "start"], { cwd: repo.root, runtime: runtime() });
    assert.equal(result.code, 0);
    assert.equal(field(result.body, "data", "quickStart"), "skipped");
    assert.equal(level(result.body, "backend", "knowledge"), "intermediate");
    assert.equal(result.stderr, "");
  });

  it("can be skipped from the terminal with q", async () => {
    const repo = await installed();
    const result = await cliJson(["perfil", "start"], { cwd: repo.root, runtime: runtime(), stdin: tty("q\n\n") });
    assert.equal(field(result.body, "data", "quickStart"), "skipped");
  });

  it("practical answers set knowledge per domain and tool literacy", async () => {
    const repo = await installed();
    const answers = tty("c\nb\na\n\nb\na\n");
    const result = await cliJson(["perfil", "start"], { cwd: repo.root, runtime: runtime(), stdin: answers });
    assert.equal(field(result.body, "data", "quickStart"), "done");
    assert.equal(level(result.body, "product", "knowledge"), "advanced");
    assert.equal(level(result.body, "backend", "knowledge"), "beginner");
    assert.equal(level(result.body, "infrastructure", "knowledge"), "intermediate");
    assert.equal(level(result.body, "security", "tool"), "advanced");
    assert.match(result.stderr, /same payment confirmation twice/);
  });

  it("init suggests the quick start and does not run it", async () => {
    const repo = makeRepo({ "README.md": "# app\n" });
    repos.push(repo);
    const init = await cliJson(["init", "--yes"], { cwd: repo.root, runtime: runtime(), version: "1.0.0" });
    assert.equal(init.code, 0);
    const text = await cliJson(["perfil"], { cwd: repo.root, runtime: runtime() });
    assert.equal(field(text.body, "data", "quickStart"), "never");
  });
});

describe("perfil: never in git, PR text or reports", () => {
  it("the profile is ignored by git and absent from the gate report", async () => {
    const repo = await installed();
    await cliJson(["perfil", "start"], { cwd: repo.root, runtime: runtime(), stdin: tty("c\nb\nb\nb\nb\na\n") });
    assert.match(repo.read(".finitemonkey/perfil.yml"), /knowledge: 70/);
    assert.equal(repo.git("check-ignore", ".finitemonkey/perfil.yml").trim(), ".finitemonkey/perfil.yml");
    repo.git("add", "-A");
    assert.doesNotMatch(repo.git("status", "--porcelain"), /perfil/);
    const gate = await cliJson(["gate"], { cwd: repo.root, runtime: runtime() });
    assert.doesNotMatch(gate.stdout, /perfil|knowledge/);
  });
});

describe("perfil: disagreement is answered with a practical question", () => {
  it("setting another level asks a question and changes only after a right answer", async () => {
    const repo = await installed();
    const said = await cli(["perfil", "set", "backend", "advanced"], {
      cwd: repo.root,
      runtime: runtime(),
      stdin: tty(""),
    });
    assert.equal(said.code, 0, said.stderr);
    assert.match(said.stdout, /One practical question about backend and data/);
    assert.match(said.stdout, /same payment confirmation twice/);
    assert.match(said.stdout, /finitemonkey perfil answer backend <a\|b\|c>/);
    assert.doesNotMatch(said.stdout, /wrong|you do not know|não sabe/i);
    const shown = await cliJson(["perfil"], { cwd: repo.root, runtime: runtime() });
    assert.equal(level(shown.body, "backend", "knowledge"), "intermediate");
    const wrong = await cliJson(["perfil", "answer", "backend", "a"], {
      cwd: repo.root,
      runtime: runtime(),
      stdin: tty(""),
    });
    assert.equal(level(wrong.body, "backend", "knowledge"), "intermediate");
    await cliJson(["perfil", "set", "backend", "advanced"], { cwd: repo.root, runtime: runtime(), stdin: tty("") });
    const right = await cliJson(["perfil", "answer", "backend", "b"], {
      cwd: repo.root,
      runtime: runtime(),
      stdin: tty(""),
    });
    assert.equal(level(right.body, "backend", "knowledge"), "advanced");
  });

  it("only the person changes the profile", async () => {
    const repo = await installed();
    const result = await cliJson(["perfil", "set", "backend", "advanced"], { cwd: repo.root, runtime: runtime() });
    assert.notEqual(result.code, 0);
  });
});

describe("perfil: sources while working", () => {
  it("technical words in requests raise knowledge of that domain only", async () => {
    const repo = await installed();
    await fire(repo, "UserPromptSubmit", { prompt: "Add a foreign key and a migration for invoices" });
    const profile = readProfile(repoRuntime(), fmPaths(repo.root));
    assert.ok(profile !== undefined);
    assert.ok(profile.domains.backend.knowledge > 50);
    assert.equal(profile.domains.interface.knowledge, 50);
  });

  it("commits outside the session raise tool literacy; commits made through the hook log do not", async () => {
    const repo = await installed();
    await fire(repo, "SessionStart", { source: "startup" });
    repo.write("a.txt", "agent\n");
    repo.commit("agent change");
    await fire(repo, "PostToolUse", {
      tool_name: "Bash",
      tool_input: { command: 'git commit -m "agent change"' },
      tool_response: { stdout: "", stderr: "", exitCode: 0 },
    });
    await fire(repo, "SessionStart", { source: "resume" });
    assert.equal(readProfile(repoRuntime(), fmPaths(repo.root)), undefined);
    repo.write("b.txt", "person\n");
    repo.commit("person change");
    await fire(repo, "SessionStart", { source: "resume" });
    const profile = readProfile(repoRuntime(), fmPaths(repo.root));
    assert.equal(profile?.domains.backend.tool, 52);
  });

  it("perfil forget deletes the profile", async () => {
    const repo = await installed();
    await cliJson(["perfil", "start"], { cwd: repo.root, runtime: runtime() });
    const forgot = await cliJson(["perfil", "forget"], { cwd: repo.root, runtime: runtime() });
    assert.equal(field(forgot.body, "data", "removed"), 1);
    assert.equal(readProfile(repoRuntime(), fmPaths(repo.root)), undefined);
  });
});

describe("perfil: SessionStart stays off git when nothing was committed", () => {
  const spied = (logs: string[]) => {
    const rt = repoRuntime();
    return {
      ...rt,
      exec: (request: Parameters<typeof rt.exec>[0]) => {
        if (request.command === "git" && request.args.includes("log")) logs.push(request.args.join(" "));
        return rt.exec(request);
      },
    };
  };

  const fireWith = (repo: Repo, rt: ReturnType<typeof repoRuntime>) =>
    runHook("SessionStart", {
      stdin: Readable.from([
        JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", cwd: repo.root, source: "startup" }),
      ]),
      deadlineMs: 20_000,
      handlers: DEFAULT_HANDLERS,
      cwd: repo.root,
      t: createTranslator("en"),
      startTimer: rt.startTimer,
      runtime: rt,
      env: {},
    });

  it("reads HEAD from the .git files, loose, packed and detached, and runs git log only after a new commit", async () => {
    const repo = await installed();
    const head = () => spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo.root, encoding: "utf8" }).stdout.trim();
    assert.equal(headShaFromFiles(repoRuntime(), repo.root), head());
    spawnSync("git", ["pack-refs", "--all"], { cwd: repo.root });
    assert.equal(headShaFromFiles(repoRuntime(), repo.root), head());
    spawnSync("git", ["checkout", "-q", "--detach"], { cwd: repo.root });
    assert.equal(headShaFromFiles(repoRuntime(), repo.root), head());
    spawnSync("git", ["checkout", "-q", "-"], { cwd: repo.root });

    const logs: string[] = [];
    await fireWith(repo, spied(logs));
    const afterFirst = logs.length;
    assert.ok(afterFirst >= 1, "the first session scans the log once");
    await fireWith(repo, spied(logs));
    assert.equal(logs.length, afterFirst, "same HEAD, no git log");
    repo.write("notes.md", "a change\n");
    repo.commit("a commit from the person");
    await fireWith(repo, spied(logs));
    assert.ok(logs.length > afterFirst, "a new commit is scanned");
  });
});
