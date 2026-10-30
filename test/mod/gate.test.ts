import { describe, type Engine, expect, mock, type MockClock, type StubOn, test } from "claude-code/testing";

const ROOT = "/work";

const status = (light: string, stale: boolean, edits: number): string =>
  JSON.stringify({
    schemaVersion: 1,
    data: {
      schema: "finitemonkey/status@1",
      task: "t1",
      contract: { id: "t1", hash: "c7f2a91e0000" },
      gate: { light, status: light === "green" ? "passed" : "failed", at: "2026-10-29T10:00:00Z" },
      checks: [
        { id: "tests", kind: "tests", status: stale ? "unverified" : "passed", stale, verify: "npm test" },
        { id: "build", kind: "command", status: "passed", stale: false, verify: "npm run build" },
      ],
      notVerified: stale ? [{ id: "tests", reason: "stale", verify: "npm test" }] : [],
      editsSinceGate: edits,
    },
  });

interface World {
  readonly clock: MockClock;
  readonly statuses: string[];
  readonly opened: string[];
  readonly lines: (string | undefined)[];
}

const world = (on: StubOn, surfaces: readonly string[]): World => {
  const clock = mock.clock(on);
  const statuses = [status("green", false, 0)];
  const opened: string[] = [];
  const lines: (string | undefined)[] = [];
  on("session.start", () => ({ cwd: ROOT }));
  on("session.root", () => ({ value: ROOT }));
  on("session.surfaces", () => ({ value: surfaces }));
  on("command.register", () => ({ value: undefined }));
  on("ui.status", (_api, e) => {
    lines.push(typeof e["text"] === "string" ? e["text"] : undefined);
    return { value: undefined };
  });
  on("ui.open", (_api, e) => {
    opened.push(String(e["id"]));
    return { value: { isPlaced: true } };
  });
  on("tool.call", () => ({ result: "ok" }));
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  on("process.run", (_api, e) => {
    const argv = Array.isArray(e["argv"]) ? e["argv"].map(String) : [];
    const stdout = argv.includes("status") ? (statuses.at(-1) ?? "") : "{}";
    return { value: { exitCode: 0, stdout, stderr: "" } };
  });
  return { clock, statuses, opened, lines };
};

const start = async ($: Engine, clock: MockClock): Promise<void> => {
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: ROOT });
  await clock.settle();
};

const BAND = {
  plugin: "finitemonkey",
  component: "AbovePrompt",
  requestId: "band",
  viewport: { columns: 140, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
};

const PANE = {
  plugin: "finitemonkey",
  component: "Pane",
  requestId: "fm-gate",
  viewport: { columns: 100, rows: 30 },
  props: {
    title: "Finite Monkey",
    isFocused: false,
    bodyColumns: 60,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
};

describe("gate band and pane", () => {
  test("the band shows the gate, and an edit after a green gate shows stale evidence within one debounce", async ($, on) => {
    const { clock, statuses } = world(on, ["terminal"]);
    await start($, clock);
    const band = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(await band.find({ type: "Text", text: "FM  gate ✓ 2/2 · contract c7f2" })).toBeDefined();
    expect(await band.find({ type: "Text", text: /not verified/ })).toBeUndefined();
    await band.unmount();
    statuses.push(status("green", true, 1));
    await $.tool.call({ tool: "Edit", file_path: "/work/src/a.ts", old_string: "a", new_string: "b" });
    await clock.advance(500);
    const after = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(
      await after.find({
        type: "Text",
        text: "FM  gate ✓ 1/2 · 1 not verified · contract c7f2 · evidence 1 edits old",
      }),
    ).toBeDefined();
  });

  test("the band button opens the pane, which lists what is not verified with the command to verify it", async ($, on) => {
    const { clock, statuses, opened } = world(on, ["terminal"]);
    statuses.push(status("red", true, 2));
    await start($, clock);
    const band = await $.ui.mount({ ...BAND, surface: "terminal" });
    await band.press({ key: "fm-open" });
    expect(opened).toEqual(["fm-gate"]);
    const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
    expect(await pane.find({ type: "Text", text: "○ tests: stale → npm test" })).toBeDefined();
    expect(await pane.find({ key: "fm-run-gate" })).toBeDefined();
  });

  test("in VS Code the pane draws and the state goes to the status line", async ($, on) => {
    const { clock, lines } = world(on, ["vscode"]);
    await start($, clock);
    const pane = await $.ui.mount({ ...PANE, surface: "vscode" });
    expect(await pane.find({ type: "Text", text: "gate ✓ 2/2 · contract c7f2" })).toBeDefined();
    expect(lines).toEqual(["FM gate ✓ 2/2 · contract c7f2 · /fm"]);
  });

  test("/fm in claude -p answers with the status as text", async ($, on) => {
    const { clock } = world(on, []);
    await start($, clock);
    const answer = await $.command.run({ command: "fm", args: "" });
    expect(answer.text).toMatch(/^finitemonkey gate ✓ 2\/2/);
  });

  test("a line under the answer names the gate and the contract", async ($, on) => {
    const { clock } = world(on, ["terminal"]);
    on("turn.complete", () => ({ text: "" }));
    await start($, clock);
    const done = await $.turn.complete({ turnId: "t", answer: "done", durationMs: 1, isAborted: false, usage: null });
    expect(done.text).toBe("FM gate ✓ · contract c7f2");
  });
});
