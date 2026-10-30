import {
  describe,
  type Engine,
  expect,
  type FixturePlugin,
  mock,
  type MockClock,
  type StubOn,
  test,
} from "claude-code/testing";

const ROOT = "/work";
const RULES = [
  {
    id: "self.policy",
    target: "path",
    pattern: String.raw`(?:^|/)\.finitemonkey/(?!reports/[^/]+\.json$)`,
    reason: "the evidence is written only by finitemonkey",
  },
  {
    id: "bypass.no_verify",
    target: "command",
    pattern: String.raw`\s--no-verify\b`,
    reason: "hooks run on every commit",
  },
];

const stateJson = (mode: string): string =>
  JSON.stringify({
    schemaVersion: 1,
    data: { schema: "finitemonkey/mod-state@1", root: ROOT, mode, failReason: "check failed", rules: RULES },
  });

const world = (on: StubOn, mode: string, recorded: string[][] = []): MockClock => {
  const clock = mock.clock(on);
  on("session.start", () => ({ cwd: ROOT }));
  on("session.root", () => ({ value: ROOT }));
  on("process.run", (_api, e) => {
    const argv = Array.isArray(e["argv"]) ? e["argv"].map(String) : [];
    if (argv.includes("record")) recorded.push(argv.slice(argv.indexOf("record") + 1));
    return { value: { exitCode: 0, stdout: argv.includes("state") ? stateJson(mode) : "{}", stderr: "" } };
  });
  return clock;
};

const allowEverything: FixturePlugin = {
  name: "allow-all",
  tier: "append",
  register: (on) => {
    on("tool.check", () => Promise.resolve({ decision: "allow" }));
  },
};

const start = async ($: Engine, clock: MockClock): Promise<void> => {
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: ROOT });
  await clock.settle();
};

describe("tighten", () => {
  test(
    "a write to the evidence is denied even when a later mod allows it",
    { plugins: [allowEverything] },
    async ($, on) => {
      const recorded: string[][] = [];
      const clock = world(on, "active", recorded);
      await start($, clock);
      const decided = await $.tool.check({
        tool: "Write",
        input: { file_path: "/work/.finitemonkey/evidence/t1.jsonl" },
      });
      expect(decided).toEqual({ decision: "deny", reason: "the evidence is written only by finitemonkey" });
      await clock.settle();
      expect(recorded).toEqual([["--rule", "self.policy", "--tool", "Write", "--mode", "active"]]);
    },
  );

  test(
    "an unrelated write keeps the decision the rest of the chain reached",
    { plugins: [allowEverything] },
    async ($, on) => {
      const clock = world(on, "active");
      await start($, clock);
      const decided = await $.tool.check({ tool: "Write", input: { file_path: "/work/src/a.ts" } });
      expect(decided).toEqual({ decision: "allow" });
    },
  );

  test("in shadow the mod records and does not tighten", { plugins: [allowEverything] }, async ($, on) => {
    const recorded: string[][] = [];
    const clock = world(on, "shadow", recorded);
    await start($, clock);
    const decided = await $.tool.check({ tool: "Bash", input: { command: "git commit -m x --no-verify" } });
    expect(decided).toEqual({ decision: "allow" });
    await clock.settle();
    expect(recorded).toEqual([["--rule", "bypass.no_verify", "--tool", "Bash", "--mode", "shadow"]]);
  });

  test("a guard that throws denies the call", async ($, on) => {
    const clock = world(on, "active");
    await start($, clock);
    const decided = await $.tool.check({ tool: "Write", input: { file_path: "/work/src/a.ts" } });
    expect(decided).toEqual({ decision: "deny", reason: "check failed" });
  });

  test("the mod never answers allow on its own over every mode, rule and decision", async ($, on) => {
    const clock = world(on, "active");
    on("tool.check", (_api, e) => {
      const input = e["input"];
      const want = typeof input === "object" && input !== null && "want" in input ? String(input.want) : "allow";
      return { decision: want };
    });
    await start($, clock);
    const inputs = [
      { tool: "Write", file_path: "/work/.finitemonkey/state.json" },
      { tool: "Write", file_path: "/work/.finitemonkey/reports/front.json" },
      { tool: "Write", file_path: "/work/src/a.ts" },
      { tool: "Bash", command: "git commit --no-verify" },
      { tool: "Bash", command: "ls" },
      { tool: "Read", file_path: "/work/.finitemonkey/state.json" },
    ];
    const rank: Readonly<Record<string, number>> = { allow: 0, ask: 1, deny: 2 };
    for (const want of ["allow", "ask", "deny"]) {
      for (const { tool, ...rest } of inputs) {
        const decided = await $.tool.check({ tool, input: { ...rest, want } });
        expect((rank[decided.decision] ?? -1) >= (rank[want] ?? 3)).toBe(true);
        if (decided.decision === "allow") expect(want).toBe("allow");
      }
    }
  });
});
