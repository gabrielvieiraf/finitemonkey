import { describe, type Engine, expect, mock, type MockClock, type StubOn, test } from "claude-code/testing";

const ROOT = "/work";
const RULES_V1 = "Project rules:\n- Use pnpm, never npm.";
const RULES_V2 = "Project rules:\n- Use pnpm, never npm.\n- Money is integer cents.";
const BRIEF = "contract t1 c7f2a91e\ngate red\nfailed attempt: tsc TS2345 (3 times)";

interface World {
  readonly clock: MockClock;
  readonly states: string[];
  readonly compacted: string[];
}

const stateOf = (instructions: string): string =>
  JSON.stringify({
    data: {
      schema: "finitemonkey/mod-state@1",
      root: ROOT,
      mode: "active",
      band: "active",
      failReason: "x",
      rules: [],
      instructions,
    },
  });

const world = (on: StubOn): World => {
  const clock = mock.clock(on);
  const states = [stateOf(RULES_V1)];
  const compacted: string[] = [];
  on("session.start", () => ({ cwd: ROOT }));
  on("session.root", () => ({ value: ROOT }));
  on("session.surfaces", () => ({ value: [] }));
  on("command.register", () => ({ value: undefined }));
  on("turn.complete", () => ({ text: "" }));
  on("prompt.compose", () => ({ sections: [{ id: "intro", text: "You are Claude Code.", scope: "shared" }] }));
  on("session.compact", (_api, e) => {
    compacted.push(typeof e["instructions"] === "string" ? e["instructions"] : "");
    return { messages: e["messages"] };
  });
  on("process.run", (_api, e) => {
    const argv = Array.isArray(e["argv"]) ? e["argv"].map(String) : [];
    if (argv.includes("state")) return { value: { exitCode: 0, stdout: states.at(-1) ?? "", stderr: "" } };
    if (argv.includes("handoff"))
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ data: { schema: "finitemonkey/handoff@1", text: BRIEF } }),
          stderr: "",
        },
      };
    return { value: { exitCode: 1, stdout: "", stderr: "" } };
  });
  return { clock, states, compacted };
};

const COMPOSE = {
  model: "claude-test",
  promptModel: "claude-test",
  surfaces: [],
  tools: [],
  outputStyle: null,
  traits: [],
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rulesText = (result: unknown): string | undefined => {
  const sections: unknown = isRecord(result) ? result["sections"] : undefined;
  const list: readonly unknown[] = Array.isArray(sections) ? sections : [];
  const found = list.filter(isRecord).find((section) => section["id"] === "finitemonkey:rules");
  return typeof found?.["text"] === "string" ? found["text"] : undefined;
};

const start = async ($: Engine, clock: MockClock): Promise<void> => {
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: ROOT });
  await clock.settle();
};

describe("rules and compaction", () => {
  test("the rules section reads the same on every request until the policy changes", async ($, on) => {
    const { clock, states } = world(on);
    await start($, clock);
    const first = rulesText(await $.prompt.compose(COMPOSE));
    const second = rulesText(await $.prompt.compose(COMPOSE));
    expect(first).toBe(RULES_V1);
    expect(second).toBe(first);
    states.push(stateOf(RULES_V2));
    await $.turn.complete({ turnId: "t", answer: "", durationMs: 1, isAborted: false, usage: null });
    await clock.settle();
    expect(rulesText(await $.prompt.compose(COMPOSE))).toBe(RULES_V2);
  });

  test("compaction keeps the contract hash and the failed attempts", async ($, on) => {
    const { clock, compacted } = world(on);
    await start($, clock);
    await $.session.compact({
      trigger: "auto",
      instructions: "keep the API names",
      messages: [{ role: "user", text: "fix the coupon", toolUses: [] }],
    });
    expect(compacted).toEqual([`keep the API names\n\n${BRIEF}`]);
  });

  test("/fm handoff prints the brief built from the ledger", async ($, on) => {
    const { clock } = world(on);
    await start($, clock);
    const answer = await $.command.run({ command: "fm", args: "handoff" });
    expect(answer.text).toBe(BRIEF);
  });
});
