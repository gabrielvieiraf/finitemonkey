import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { HOOK_EVENTS } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS, type HookInput } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { whenEnabled } from "../src/provider/adapters.js";
import { answerOf, callProvider } from "../src/provider/call.js";
import { providerStop } from "../src/provider/hook.js";
import { PROVIDER_ENV, PROVIDER_KINDS } from "../src/provider/kinds.js";
import { estimateOf, spentToday } from "../src/provider/ledger.js";
import { enabledKinds, proposalsFile } from "../src/provider/store.js";
import { stringList } from "../src/provider/validate.js";
import { divergenceSource, providerJudge, unattendedAgent } from "../src/provider/wire.js";
import { answer, PROJECT, world } from "./provider-support.js";
import { cli, cliJson, execResult, field, stdinFrom } from "./support.js";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const payload = (event: string): string =>
  JSON.stringify({ session_id: "s1", cwd: PROJECT, hook_event_name: event, tool_name: "Read", tool_input: {} });

const split = { kind: "claim-split" as const, payload: { text: "a. b." }, validate: stringList };

describe("model provider is off by default", () => {
  it("with no kind enabled, no command or hook spawns claude", async () => {
    const w = world({ mode: "active", fake: { answer: answer(["x"]) } });
    for (const event of HOOK_EVENTS) {
      await runHook(event, {
        stdin: stdinFrom(payload(event)),
        deadlineMs: 5000,
        handlers: DEFAULT_HANDLERS,
        cwd: PROJECT,
        t: createTranslator("en"),
        startTimer: w.runtime.startTimer,
        runtime: w.runtime,
        env: {},
      });
    }
    for (const kind of PROVIDER_KINDS) {
      assert.equal(callProvider(w.deps, { ...split, kind }).status, "off");
      assert.equal(
        whenEnabled(w.deps, kind, () => true),
        undefined,
      );
    }
    assert.deepEqual(providerJudge(w.deps), {});
    assert.equal(divergenceSource(w.deps, undefined, undefined), undefined);
    assert.equal(unattendedAgent(w.deps), undefined);
    for (const argv of [["provider", "list"], ["provider", "run", "blind-writer"], ["mod", "cost"], ["look"]]) {
      await cliJson(argv, { cwd: PROJECT, runtime: w.runtime });
    }
    assert.deepEqual(w.calls, []);
    assert.deepEqual(w.spawned, []);
  });

  it("a nested call from inside a provider session never spawns claude again", () => {
    const w = world({
      kinds: ["claim-split"],
      mode: "active",
      fake: { answer: answer(["a"]) },
      env: { [PROVIDER_ENV]: "claim-split" },
    });
    assert.equal(callProvider(w.deps, split).status, "nested");
    assert.deepEqual(w.calls, []);
  });

  it("the Stop hook only starts the blind writer in the background, and only when it is on", async () => {
    const off = world({ files: { ".finitemonkey/state.json": '{"active":"t1"}\n' } });
    const input = (w: ReturnType<typeof world>): HookInput => ({
      event: "Stop",
      payload: { hookEventName: "Stop", sessionId: "s1", cwd: PROJECT, stopHookActive: false, raw: {} },
      runtime: w.runtime,
      cwd: PROJECT,
      t: createTranslator("en"),
      env: {},
    });
    await providerStop(input(off));
    assert.deepEqual(off.spawned, []);
    const on = world({ kinds: ["blind-writer"], files: { ".finitemonkey/state.json": '{"active":"t1"}\n' } });
    await providerStop(input(on));
    assert.deepEqual(on.spawned, [["provider", "run", "blind-writer", "--task", "t1"]]);
    assert.deepEqual(on.calls, []);
  });
});

describe("provider enable", () => {
  it("provider enable run by the agent is refused", async () => {
    const w = world();
    const inside = await cliJson(["provider", "enable", "critic", "--yes"], {
      cwd: PROJECT,
      runtime: w.runtime,
      stdin: tty(),
      env: { CLAUDECODE: "1" },
    });
    assert.equal(field(inside.body, "error", "code"), "needs_confirmation");
    const piped = await cliJson(["provider", "enable", "critic", "--yes"], { cwd: PROJECT, runtime: w.runtime });
    assert.equal(field(piped.body, "error", "code"), "needs_confirmation");
    assert.deepEqual(enabledKinds(w.runtime, w.paths), []);
  });

  it("shows what the kind sends, the cost estimate and the cap, and turns it on only with --yes", async () => {
    const w = world({ cap: "3" });
    const preview = await cliJson(["provider", "enable", "critic"], { cwd: PROJECT, runtime: w.runtime, stdin: tty() });
    assert.equal(field(preview.body, "data", "enabled"), false);
    const text = await cli(["provider", "enable", "critic"], { cwd: PROJECT, runtime: w.runtime, stdin: tty() });
    assert.match(text.stdout, /screenshot/);
    assert.match(text.stdout, /\$0\.05/);
    assert.match(text.stdout, /\$3\.00/);
    assert.deepEqual(enabledKinds(w.runtime, w.paths), []);
    const done = await cliJson(["provider", "enable", "critic", "--yes"], {
      cwd: PROJECT,
      runtime: w.runtime,
      stdin: tty(),
    });
    assert.equal(field(done.body, "data", "enabled"), true);
    assert.deepEqual(
      enabledKinds(w.runtime, w.paths).map((entry) => entry.kind),
      ["critic"],
    );
    const off = await cliJson(["provider", "disable", "critic"], { cwd: PROJECT, runtime: w.runtime });
    assert.equal(off.code, 0);
    assert.deepEqual(enabledKinds(w.runtime, w.paths), []);
  });
});

describe("provider calls", () => {
  it("each call records tokens, USD and duration, and cost sums them per task and kind", async () => {
    const w = world({
      kinds: ["claim-split", "support"],
      mode: "active",
      fake: { answer: answer(["one", "two"]), usd: 0.02 },
      files: { ".finitemonkey/state.json": '{"active":"t1"}\n' },
    });
    assert.deepEqual(callProvider(w.deps, split), { status: "ok", value: ["one", "two"] });
    callProvider(w.deps, split);
    callProvider(w.deps, { kind: "support", payload: { claim: "c" }, validate: () => "p" });
    const args = w.calls[0]?.args ?? [];
    assert.ok(args.includes("--output-format") && args.includes("json"));
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.deepEqual(w.calls[0]?.unset, ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]);
    const cost = await cliJson(["mod", "cost"], {
      cwd: PROJECT,
      runtime: {
        ...w.runtime,
        exec: (request) =>
          request.command === "git" && request.args.includes("--show-toplevel")
            ? execResult(0, `${PROJECT}\n`)
            : w.runtime.exec(request),
      },
    });
    assert.equal(field(cost.body, "data", "task"), "t1");
    assert.deepEqual(field(cost.body, "data", "byKind"), [
      { kind: "claim-split", usd: 0.04, calls: 2, tokens: 250, durationMs: 2400 },
      { kind: "support", usd: 0.02, calls: 1, tokens: 125, durationMs: 1200 },
    ]);
    assert.equal(estimateOf(w.runtime, w.paths, "claim-split").source, "median");
    assert.equal(estimateOf(w.runtime, w.paths, "claim-split").usd, 0.02);
  });

  it("the daily cap stops further calls and reports it", async () => {
    const w = world({
      kinds: ["claim-split"],
      mode: "active",
      cap: "0.05",
      fake: { answer: answer(["a"]), usd: 0.03 },
    });
    assert.equal(callProvider(w.deps, split).status, "ok");
    assert.equal(callProvider(w.deps, split).status, "ok");
    const third = callProvider(w.deps, split);
    assert.deepEqual(third, { status: "capped", spent: 0.06, cap: 0.05 });
    assert.equal(w.calls.length, 2);
    assert.equal(spentToday(w.runtime, w.paths), 0.06);
    assert.match(w.fs.read(w.paths.log) ?? "", /"event":"provider.capped"/);
    const listed = await cliJson(["provider", "list"], { cwd: PROJECT, runtime: w.runtime });
    assert.equal(field(listed.body, "data", "capped"), true);
  });

  it("in shadow a proposal is recorded and counted but not handed to the flow", () => {
    const w = world({ kinds: ["claim-split"], fake: { answer: answer(["a", "b"]) } });
    const outcome = callProvider(w.deps, split);
    assert.equal(outcome.status, "shadow");
    const line = JSON.parse(w.fs.read(proposalsFile(w.paths))?.trim() ?? "{}") as unknown;
    assert.equal(field(line, "origin"), "model-proposed");
    assert.equal(field(line, "items"), 2);
    assert.equal(field(line, "mode"), "shadow");
  });

  it("drops and logs output that does not fit the interface", () => {
    const w = world({ kinds: ["claim-split"], mode: "active", fake: { answer: answer({ claims: "no" }) } });
    assert.equal(callProvider(w.deps, split).status, "invalid");
    assert.match(w.fs.read(w.paths.log) ?? "", /"event":"provider.invalid"/);
  });

  it("reads JSON from a fenced or chatty answer", () => {
    assert.deepEqual(answerOf('```json\n["a"]\n```'), ["a"]);
    assert.deepEqual(answerOf('Here: {"pick": "b"} done'), { pick: "b" });
    assert.equal(answerOf("no json here"), undefined);
  });
});
