import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest, ExecResult, Runtime } from "../src/core/runtime.js";
import { prodCheck } from "../src/gate/checks/prod.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, execResult, field, parseBody, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const URL = "https://shop.example.com/version";
const REAL_TIMER = repoRuntime().startTimer;
const OLD = "0123456789abcdef0123456789abcdef01234567";

interface Fakes {
  readonly calls: ExecRequest[];
  readonly spawned: string[][];
  readonly runtime: Runtime;
}

const project = (config: string): Repo => {
  const repo = makeRepo({ "README.md": "# shop\n", ".finitemonkey/config.yml": `lang: en\n${config}` });
  repos.push(repo);
  return repo;
};

const fakes = (answers: readonly ((request: ExecRequest) => ExecResult | undefined)[]): Fakes => {
  const calls: ExecRequest[] = [];
  const spawned: string[][] = [];
  const base = repoRuntime({ spawned });
  let turn = 0;
  const runtime: Runtime = {
    ...base,
    startTimer: (_ms, fire) => {
      queueMicrotask(fire);
      return () => undefined;
    },
    exec: (request) => {
      if (request.command !== "curl" && request.command !== "gh") return base.exec(request);
      calls.push(request);
      const answer = answers[Math.min(turn, answers.length - 1)];
      if (request.command === "curl") turn += 1;
      return answer?.(request) ?? execResult(1, "", "unexpected");
    },
  };
  return { calls, spawned, runtime };
};

const version =
  (commit: string, status = 200) =>
  (request: ExecRequest): ExecResult | undefined => {
    if (request.command === "curl") return execResult(0, `${JSON.stringify({ commit })}\n${String(status)}`);
    return request.args[0] === "run" ? execResult(0, "[]") : undefined;
  };

const head = (repo: Repo): string => repo.git("rev-parse", "HEAD").trim();

const status = async (repo: Repo, runtime: Runtime, ...flags: readonly string[]) =>
  cliJson(["deploy", "status", ...flags], { cwd: repo.root, runtime });

const line = async (repo: Repo, runtime: Runtime): Promise<string> =>
  (await cli(["deploy", "status"], { cwd: repo.root, runtime })).stdout;

const fire = (
  repo: Repo,
  runtime: Runtime,
  event: HookEvent,
  payload: Readonly<Record<string, unknown>>,
): Promise<HookOutcome> =>
  runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: repo.root, ...payload })),
    deadlineMs: 20_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: REAL_TIMER,
    runtime,
    env: {},
  });

const push = { tool_name: "Bash", tool_input: { command: "git push origin main" }, tool_response: { exitCode: 0 } };

describe("deploy status: no network without deploy configured", () => {
  it("the command and the hooks make no curl or gh call", async () => {
    const repo = project("");
    const { calls, spawned, runtime } = fakes([version(OLD)]);
    const shown = await status(repo, runtime);
    assert.equal(field(shown.body, "data", "configured"), false);
    await fire(repo, runtime, "PostToolUse", push);
    await fire(repo, runtime, "Stop", { stop_hook_active: false, last_assistant_message: "Pushed." });
    assert.deepEqual(calls, []);
    assert.deepEqual(spawned, []);
  });
});

describe("deploy status: version endpoint", () => {
  it("a lagging endpoint shows not live, then the commit with what to test", async () => {
    const repo = project(`deploy:\n  version_url: ${URL}\n`);
    repo.write(".finitemonkey/state.json", JSON.stringify({ active: "pix" }));
    repo.write(
      ".finitemonkey/tasks/pix.yml",
      "id: pix\ngoal: Pay with Pix\nacceptance:\n  - id: M1\n    check: manual\n    description: pay R$ 1 with Pix on the checkout\n",
    );
    const { runtime } = fakes([version(OLD), version(head(repo))]);
    assert.match(
      await line(repo, runtime),
      /Not live yet: https:\/\/shop\.example\.com\/version answers 01234567, expected/,
    );
    assert.match(
      await line(repo, runtime),
      new RegExp(`Live: ${head(repo).slice(0, 8)} at ${URL}\\. Test now: pay R\\$ 1 with Pix`),
    );
  });

  it("--wait polls up to the ceiling until the commit is live", async () => {
    const repo = project(`deploy:\n  version_url: ${URL}\n  wait_s: 60\n  interval_s: 10\n`);
    const { calls, runtime } = fakes([version(OLD), version(OLD), version(head(repo))]);
    const waited = await status(repo, runtime, "--wait");
    assert.equal(field(waited.body, "data", "state"), "live");
    assert.equal(calls.filter((call) => call.command === "curl").length, 3);
  });

  it("a failing workflow run for the pushed commit is reported with its URL", async () => {
    const run = "https://github.com/acme/shop/actions/runs/42";
    const repo = project(`deploy:\n  version_url: ${URL}\n`);
    const { runtime } = fakes([
      (request) =>
        request.command === "curl"
          ? execResult(0, `${JSON.stringify({ commit: OLD })}\n200`)
          : execResult(0, JSON.stringify([{ conclusion: "failure", status: "completed", url: run }])),
    ]);
    assert.match(await line(repo, runtime), new RegExp(`failed, see ${run.replace(/[/.]/g, "\\$&")}`));
  });
});

describe("deploy status: GitHub deployments", () => {
  it("reads the deployment of the pushed commit and reports a failure with its log URL", async () => {
    const log = "https://github.com/acme/shop/actions/runs/7";
    const repo = project("deploy:\n  environment: production\n");
    const { calls, runtime } = fakes([
      (request) => {
        const path = request.args[1] ?? "";
        if (path.includes("/statuses")) return execResult(0, JSON.stringify([{ state: "failure", log_url: log }]));
        return execResult(0, JSON.stringify([{ id: 99 }]));
      },
    ]);
    const shown = await status(repo, runtime);
    assert.equal(field(shown.body, "data", "state"), "failed");
    assert.equal(field(shown.body, "data", "run"), log);
    assert.ok(calls.some((call) => (call.args[1] ?? "").includes(`environment=production&sha=${head(repo)}`)));
  });
});

describe("deploy status: after a push", () => {
  it("Stop starts the background check once and the next prompt shows the line once", async () => {
    const repo = project(`deploy:\n  version_url: ${URL}\n`);
    const { calls, spawned, runtime } = fakes([version(OLD)]);
    await fire(repo, runtime, "PostToolUse", push);
    await fire(repo, runtime, "Stop", { stop_hook_active: false, last_assistant_message: "Pushed." });
    await fire(repo, runtime, "Stop", { stop_hook_active: false, last_assistant_message: "Pushed." });
    assert.deepEqual(spawned, [["deploy", "status", "--wait", "--report"]]);
    assert.deepEqual(calls, []);
    await status(repo, runtime, "--report");
    const shown = await fire(repo, runtime, "UserPromptSubmit", { prompt: "can I test it?" });
    assert.match(String(field(parseBody(shown.stdout), "systemMessage")), /Not live yet/);
    const again = await fire(repo, runtime, "UserPromptSubmit", { prompt: "and now?" });
    assert.equal(field(parseBody(again.stdout), "systemMessage"), undefined);
  });
});

describe("gate: prod check", () => {
  it("passes only when the live version answers with the task commit and the expected status", () => {
    const repo = project(`deploy:\n  version_url: ${URL}\n`);
    const check = { id: "live", kind: "prod" } as const;
    const outcomeWith = (answer: (request: ExecRequest) => ExecResult | undefined) => {
      const { runtime } = fakes([answer]);
      const ready = prepareGate({
        runtime,
        cwd: repo.root,
        env: {},
        sessionId: undefined,
        budgetMs: 1000,
        fast: true,
        noSkip: true,
      });
      if (ready.kind !== "ready") throw new Error(ready.kind);
      return prodCheck(check, ready.prepared.ctx);
    };
    assert.equal(outcomeWith(version(head(repo))).status, "passed");
    assert.equal(outcomeWith(version(OLD)).status, "failed");
    assert.equal(outcomeWith(version(head(repo), 503)).status, "failed");
    assert.equal(outcomeWith(() => execResult(6, "", "could not resolve host")).status, "unverified");
  });
});
