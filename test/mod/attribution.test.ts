import { describe, type Engine, expect, mock, type MockClock, type StubOn, test } from "claude-code/testing";

const ROOT = "/work";
const CREDIT = "Co-Authored-By: an AI assistant <noreply@example.com>";

const world = (on: StubOn, attribution: { forbid: boolean; trailer: string | null }): MockClock => {
  const clock = mock.clock(on);
  on("session.start", () => ({ cwd: ROOT }));
  on("session.root", () => ({ value: ROOT }));
  on("session.surfaces", () => ({ value: [] }));
  on("command.register", () => ({ value: undefined }));
  on("attribution.text", (_api, e) => ({ text: String(e["text"]) }));
  on("process.run", (_api, e) => {
    const argv = Array.isArray(e["argv"]) ? e["argv"].map(String) : [];
    const state = {
      schema: "finitemonkey/mod-state@1",
      root: ROOT,
      mode: "active",
      band: "active",
      failReason: "x",
      rules: [],
      attribution,
    };
    return { value: { exitCode: argv.includes("state") ? 0 : 1, stdout: JSON.stringify({ data: state }), stderr: "" } };
  });
  return clock;
};

const start = async ($: Engine, clock: MockClock): Promise<void> => {
  await $.session.start({ surface: null, isInteractive: false, cwd: ROOT });
  await clock.settle();
};

describe("attribution", () => {
  test("with the no-attribution rule, commits and pull requests get no credit line", async ($, on) => {
    const clock = world(on, { forbid: true, trailer: null });
    await start($, clock);
    expect(await $.attribution.text({ kind: "commit", text: CREDIT })).toEqual({ text: "" });
    expect(await $.attribution.text({ kind: "pr", text: "Generated with a tool" })).toEqual({ text: "" });
    expect(await $.attribution.text({ kind: "remedy", text: "keep" })).toEqual({ text: "keep" });
  });

  test("the trailer, when turned on, carries the verdict and tree of the last gate run", async ($, on) => {
    const clock = world(on, { forbid: true, trailer: "Verified-by: finitemonkey passed tree:9a1e" });
    await start($, clock);
    expect(await $.attribution.text({ kind: "commit", text: CREDIT })).toEqual({
      text: "Verified-by: finitemonkey passed tree:9a1e",
    });
    expect(await $.attribution.text({ kind: "pr", text: CREDIT })).toEqual({ text: "" });
  });

  test("without the rule the text Claude Code composed stays", async ($, on) => {
    const clock = world(on, { forbid: false, trailer: null });
    await start($, clock);
    expect(await $.attribution.text({ kind: "commit", text: CREDIT })).toEqual({ text: CREDIT });
  });
});
