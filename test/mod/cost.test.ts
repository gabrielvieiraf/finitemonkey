import { describe, type Engine, expect, mock, type MockClock, type StubOn, test } from "claude-code/testing";

const ROOT = "/work";
const CHUNKS = [
  { kind: "text", index: 0, text: "Hello" },
  { kind: "text", index: 0, text: " world" },
];
const USAGE = {
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 5000,
  cache_creation_input_tokens: 100,
  model: "claude-opus-5-5",
};
const COST = {
  schema: "finitemonkey/mod-cost@1",
  task: "t1",
  usd: 1.84,
  requests: 12,
  attempts: 3,
  perAttempt: 0.6133,
  byArm: [{ arm: "clarify=shadow", usd: 1.84, requests: 12 }],
};

const world = (on: StubOn, runs: string[][]): MockClock => {
  const clock = mock.clock(on);
  on("session.start", () => ({ cwd: ROOT }));
  on("session.root", () => ({ value: ROOT }));
  on("session.surfaces", () => ({ value: [] }));
  on("command.register", () => ({ value: undefined }));
  on("turn.complete", () => ({ text: "" }));
  on("turn.step", async function* (_api, e) {
    for (const chunk of CHUNKS) yield chunk;
    await Promise.resolve();
    return {
      turnId: e["turnId"],
      index: e["index"],
      answer: "Hello world",
      toolUses: [],
      stopReason: "end_turn",
      usage: USAGE,
    };
  });
  on("process.run", (_api, e) => {
    const argv = Array.isArray(e["argv"]) ? e["argv"].map(String) : [];
    runs.push(argv);
    const stdout = argv.includes("cost") ? JSON.stringify({ data: COST }) : "{}";
    return { value: { exitCode: argv.includes("cost") ? 0 : 1, stdout, stderr: "" } };
  });
  return clock;
};

const start = async ($: Engine, clock: MockClock): Promise<void> => {
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT });
  await clock.settle();
};

describe("cost per task", () => {
  test("the stream reaches the person unchanged and the usage is recorded after the turn", async ($, on) => {
    const runs: string[][] = [];
    const clock = world(on, runs);
    await start($, clock);
    const stream = $.turn.step({ turnId: "t", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    const seen: unknown[] = [];
    let step = await stream.next();
    while (step.done !== true) {
      seen.push(step.value);
      step = await stream.next();
    }
    expect(seen).toEqual(CHUNKS);
    expect(step.value).toMatchObject({ answer: "Hello world", usage: USAGE });
    await $.turn.complete({ turnId: "t", answer: "Hello world", durationMs: 1, isAborted: false, usage: null });
    await clock.settle();
    const usage = runs.find((argv) => argv.includes("usage"));
    expect(usage?.at(-1)).toBe(
      JSON.stringify([
        { model: "claude-opus-5-5", agent: null, input: 1200, output: 300, cacheRead: 5000, cacheWrite: 100 },
      ]),
    );
  });

  test("/fm cost names the contract cost, the cost per attempt and each arm", async ($, on) => {
    const clock = world(on, []);
    await start($, clock);
    const answer = await $.command.run({ command: "fm", args: "cost" });
    expect(answer.text).toBe(
      "contract t1: $1.84 in 12 requests\nattempts 3 · per attempt $0.61\narm clarify=shadow: $1.84 in 12 requests",
    );
  });
});
