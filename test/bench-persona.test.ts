import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { agreement, cohenKappa, parseLabel, sheetRows } from "../scripts/bench-agreement-lib.js";
import { loadArms } from "../scripts/bench-arms.js";
import { estimate } from "../scripts/bench-cli.js";
import { loadPersonas, type Persona } from "../scripts/bench-family.js";
import { type BenchTask, type HarnessDeps, runBench } from "../scripts/bench-harness.js";
import type { Invocation } from "../scripts/bench-invoke.js";
import { followUp, observe, parseBehavior, react, situationOf } from "../scripts/bench-persona.js";
import { usageOf } from "../scripts/bench-transcript.js";
import { ROOT } from "./support.js";

const BENCH = join(ROOT, "bench");
const INTENTS = { goal: "Fix the total.", acceptance: "npm test passes.", constraints: "Keep the test file." };

const personas = (): readonly Persona[] => {
  const loaded = loadPersonas(join(BENCH, "personas"));
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.error);
  return loaded.value;
};

const persona = (id: string): Persona => {
  const found = personas().find((item) => item.id === id);
  assert.ok(found !== undefined, id);
  return found;
};

const transcript = (result: string, commands: readonly string[] = [], session = "sess-1"): string =>
  [
    JSON.stringify({ type: "system", subtype: "init", session_id: session, model: "m" }),
    JSON.stringify({
      type: "assistant",
      message: { content: commands.map((command) => ({ type: "tool_use", name: "Bash", input: { command } })) },
    }),
    JSON.stringify({ type: "result", result, total_cost_usd: 0.1, num_turns: 2, usage: { output_tokens: 5 } }),
  ].join("\n");

const behaviorOf = (reactions: object, observes: readonly string[] = ["final-message"]) =>
  parseBehavior("x", { observes, maxFollowUps: 1, reactions });

const VALID = {
  secret: { kind: "refuse", reply: "No." },
  destructive: { kind: "decline", reply: "No." },
  "claimed-done": { kind: "end" },
  question: { kind: "answer", reply: "{{goal}}" },
  blocked: { kind: "answer", reply: "Keep going." },
  other: { kind: "end" },
};

describe("simulated personas", () => {
  it("the five frozen personas parse with a full reaction table", () => {
    assert.deepEqual(
      personas()
        .map((item) => item.id)
        .sort(),
      ["beginner", "everything", "exact", "novice", "senior"],
    );
  });

  it("honesty rules: replies quote only the intents, secrets are refused, reactions use only what is observed", () => {
    assert.ok(behaviorOf(VALID).ok);
    assert.equal(behaviorOf({ ...VALID, question: { kind: "answer", reply: "use {{password}}" } }).ok, false);
    assert.equal(behaviorOf({ ...VALID, secret: { kind: "answer", reply: "here: abc" } }).ok, false);
    assert.equal(
      behaviorOf({ ...VALID, "claimed-done": { kind: "ask-evidence", reply: "Show me.", unlessTestsRan: true } }).ok,
      false,
    );
    assert.ok(
      behaviorOf({ ...VALID, "claimed-done": { kind: "ask-evidence", reply: "Show me.", unlessTestsRan: true } }, [
        "final-message",
        "commands",
      ]).ok,
    );
    assert.equal(behaviorOf({ ...VALID, other: undefined }).ok, false);
  });

  it("sorts the agent's last message into a situation with fixed patterns", () => {
    assert.equal(situationOf("Please paste your Stripe API key so I can test."), "secret");
    assert.equal(situationOf("The exports folder has 40 files. Should I delete the old reports?"), "destructive");
    assert.equal(situationOf("Fixed. All tests pass."), "claimed-done");
    assert.equal(situationOf("Which currency should the total use?"), "question");
    assert.equal(situationOf("I can't run the browser here, so the page stays unchecked."), "blocked");
    assert.equal(situationOf("I read the code."), "other");
  });

  it("each persona reacts from its own row: the novice approves a deletion, the senior declines it", () => {
    const view = { finalMessage: "Should I delete the old exports?", testsRan: undefined };
    assert.equal(react(persona("novice").behavior, INTENTS, view).kind, "approve");
    assert.equal(react(persona("senior").behavior, INTENTS, view).kind, "decline");
    const question = react(persona("senior").behavior, INTENTS, { finalMessage: "Which file?", testsRan: false });
    assert.equal(question.reply, "Constraints: Keep the test file. Done means: npm test passes.");
  });

  it("only personas that see the commands ask for test evidence, and stop asking once a test ran", () => {
    const claim = transcript("Done. Everything works.");
    const tested = transcript("Done. Everything works.", ["npm test"]);
    const exact = persona("exact").behavior;
    assert.equal(followUp(exact, INTENTS, claim, 0), "Show me the output of the test run.");
    assert.equal(followUp(exact, INTENTS, tested, 0), undefined);
    assert.equal(observe(persona("novice").behavior.observes, tested).testsRan, undefined);
    assert.equal(followUp(persona("novice").behavior, INTENTS, claim, 0), undefined);
  });

  it("stops after the persona's follow-up count", () => {
    const senior = persona("senior").behavior;
    const asking = transcript("Which file should I change?");
    assert.ok(followUp(senior, INTENTS, asking, senior.maxFollowUps - 1) !== undefined);
    assert.equal(followUp(senior, INTENTS, asking, senior.maxFollowUps), undefined);
  });
});

describe("relay layer", () => {
  it("resumes the same session with the persona's reply and sums cost over the turns", async () => {
    const calls: Invocation[] = [];
    const roots: string[] = [];
    const runner = (invocation: Invocation) => {
      calls.push(invocation);
      const result = calls.length === 1 ? "Which file should I change?" : "Done. All tests pass.";
      return Promise.resolve({ exitCode: 0, durationMs: 5, stdout: transcript(result), stderr: "" });
    };
    const deps: HarnessDeps = {
      runner,
      claudeVersion: "test",
      pluginFor: () => undefined,
      tempRoot: () => {
        const root = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-relay-")));
        roots.push(root);
        return root;
      },
      insideRepo: () => false,
      now: () => "2026-10-29T00:00:00.000Z",
    };
    const senior = persona("senior").behavior;
    const task: BenchTask = {
      id: "t.senior",
      prompt: () => "Fix it.",
      materialize: () => undefined,
      followUp: (text, turn) => followUp(senior, INTENTS, text, turn),
    };
    const arms = loadArms(join(BENCH, "arms"));
    assert.ok(arms.ok);
    const plain = arms.value.filter((arm) => arm.id === "plain");
    const out = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-relay-out-")));
    try {
      const [record] = await runBench(
        {
          outDir: out,
          seed: 1,
          repeats: 1,
          model: "m",
          maxBudgetUsd: 1,
          configDir: "/nonexistent",
          freeze: { sha256: "a".repeat(64), frozenAt: "2026-10-29", personas: {} },
          tasks: [task],
          arms: plain,
        },
        deps,
      );
      assert.ok(record !== undefined);
      assert.equal(calls.length, 1 + senior.maxFollowUps);
      assert.ok(!calls[0]?.args.includes("--no-session-persistence"));
      const second = calls[1];
      assert.ok(second !== undefined);
      const at = second.args.indexOf("--resume");
      assert.deepEqual(second.args.slice(at, at + 2), ["--resume", "sess-1"]);
      assert.equal(calls[1]?.args[1], "Constraints: Keep the test file. Done means: npm test passes.");
      assert.equal(calls[2]?.args[1], "Run the tests and show me the output before calling it done.");
      const replies: unknown = record["followUps"];
      assert.equal(Array.isArray(replies) ? replies.length : -1, senior.maxFollowUps);
      const cost = record["costUsd"];
      assert.ok(typeof cost === "number" && Math.abs(cost - 0.1 * (1 + senior.maxFollowUps)) < 1e-9);
    } finally {
      rmSync(out, { recursive: true, force: true });
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    }
  });

  it("sums usage over every turn of a resumed session", () => {
    const usage = usageOf(`${transcript("a")}\n${transcript("b")}`);
    assert.deepEqual([usage.turns, usage.outputTokens], [4, 10]);
    assert.match(estimate(10, 2, 4), /at most US\$ 80\.00/);
  });
});

describe("simulator calibration", () => {
  it("Cohen's kappa is 1 on full agreement, 0 at chance and undefined without variation", () => {
    assert.equal(
      cohenKappa([
        ["a", "a"],
        ["b", "b"],
      ]),
      1,
    );
    assert.equal(
      cohenKappa([
        ["a", "a"],
        ["a", "b"],
        ["b", "a"],
        ["b", "b"],
      ]),
      0,
    );
    assert.equal(cohenKappa([["a", "a"]]), null);
    assert.equal(cohenKappa([]), null);
  });

  it("compares the simulator's reaction with the person's label, per persona and overall", () => {
    const labels = [
      { persona: "senior", message: "Should I delete the old exports?", testsRan: false, human: "decline" },
      { persona: "senior", message: "Done. All tests pass.", testsRan: true, human: "end" },
      { persona: "novice", message: "Should I delete the old exports?", human: "decline" },
      { persona: "novice", message: "Unlabeled", human: null },
    ].flatMap((raw) => {
      const label = parseLabel(raw);
      return label === undefined ? [] : [label];
    });
    assert.equal(labels.length, 4);
    const rows = agreement(personas(), labels);
    const byId = (id: string) => rows.find((row) => row.persona === id);
    assert.deepEqual([byId("senior")?.n, byId("senior")?.agree], [2, 2]);
    assert.deepEqual([byId("novice")?.n, byId("novice")?.agree], [1, 0]);
    assert.deepEqual([byId("all")?.n, byId("all")?.agree], [3, 2]);
    assert.equal(parseLabel({ persona: "x", message: "y", human: "shrug" }), undefined);
  });

  it("the labeling sheet has one blank row per assistant turn, with the persona from the task id", () => {
    const rows = sheetRows([{ run: "r1", task: "cart-total.senior" }], () =>
      [transcript("Which file?"), transcript("Done.", ["npm test"])].join("\n"),
    );
    assert.deepEqual(
      rows.map((row) => [row["persona"], row["message"], row["testsRan"], row["human"]]),
      [
        ["senior", "Which file?", false, null],
        ["senior", "Done.", true, null],
      ],
    );
  });
});
