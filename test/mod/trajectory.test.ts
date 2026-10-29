import { describe, expect, mock, type StubOn, test } from "claude-code/testing";

const ROOT = "/work";

const week = (key: string, filled: boolean, work: number | null) => ({
  week: key,
  independent: filled ? 1 : null,
  discernment: filled ? 2 : null,
  assisted: filled ? 3 : null,
  blindCovered: 0,
  blindBare: filled ? 1 : 0,
  work: filled ? work : null,
  evidence: filled ? 1 : 0,
});

const DATA = JSON.stringify({
  data: {
    schema: "finitemonkey/trajectory@1",
    domains: [
      {
        domain: "backend",
        status: "ok",
        evidence: 7,
        weeks: [week("2026-W41", true, 0.5), week("2026-W42", false, null), week("2026-W43", true, 2.5)],
        marks: [
          {
            kind: "ricochet",
            week: "2026-W43",
            concept: "webhook",
            at: "2026-10-22T10:00:00Z",
            evidence: [
              { kind: "exposure", at: "2026-10-20T10:00:00Z", concept: "webhook", task: "t2", file: "src/webhook.ts" },
              {
                kind: "failure_after_approval",
                at: "2026-10-22T10:00:00Z",
                concept: "webhook",
                task: "t5",
                file: "src/webhook.ts",
              },
            ],
          },
        ],
        position: "2026-W43",
      },
      { domain: "security", status: "no_data", evidence: 1, weeks: [], marks: [], position: null },
    ],
  },
});

const world = (on: StubOn, surfaces: readonly string[]): void => {
  mock.clock(on);
  on("session.root", () => ({ value: ROOT }));
  on("session.surfaces", () => ({ value: surfaces }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("ui.close", () => ({ value: undefined }));
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: DATA, stderr: "" } }));
};

const pane = (surface: string): Readonly<Record<string, unknown>> => ({
  plugin: "finitemonkey",
  component: "Pane",
  requestId: "fm-trajectory",
  surface,
  viewport: { columns: 120, rows: 40 },
  props: {
    title: "Finite Monkey · trajectory",
    isFocused: false,
    bodyColumns: 80,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
});

describe("trajectory pane", () => {
  test("the terminal draws the chart as Raster cells and a ricochet opens its evidence", async ($, on) => {
    world(on, ["terminal"]);
    await $.command.run({ command: "fm", args: "trajectory" });
    const drawn = await $.ui.mount(pane("terminal"));
    expect(await drawn.find({ type: "Raster" })).toBeDefined();
    expect(await drawn.find({ type: "Text", text: "security: no data (1 weighted events)" })).toBeDefined();
    await drawn.press({ key: "fm-trajectory-mark-backend-0" });
    await drawn.unmount();
    const again = await $.ui.mount(pane("terminal"));
    expect(
      await again.find({ type: "Text", text: /failure_after_approval · task t5 · src\/webhook.ts/ }),
    ).toBeDefined();
  });

  test("Desktop and VS Code draw the same chart as Svg", async ($, on) => {
    world(on, ["desktop"]);
    await $.command.run({ command: "fm", args: "trajectory" });
    const drawn = await $.ui.mount(pane("desktop"));
    expect(await drawn.find({ type: "Svg" })).toBeDefined();
    expect(await drawn.find({ type: "Raster" })).toBeUndefined();
  });

  test("in -p the trajectory is a text table", async ($, on) => {
    world(on, []);
    const result = await $.command.run({ command: "fm", args: "trajectory" });
    expect(result.text).toMatch(/backend .*↯/);
    expect(result.text).toMatch(/security +no data/);
  });
});
