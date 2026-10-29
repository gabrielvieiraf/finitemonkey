import { describe, expect, mock, type StubOn, test } from "claude-code/testing";

const ROOT = "/work";

const XRAY = JSON.stringify({
  data: {
    schema: "finitemonkey/xray@1",
    task: "refund",
    beyondWithoutCriterion: 1,
    items: [
      {
        file: "src/webhook.ts",
        start: 10,
        end: 12,
        band: "beyond",
        coverage: "none",
        concepts: [{ concept: "webhook", state: "beyond" }],
        by: "agent",
      },
      {
        file: "src/api.ts",
        start: 1,
        end: 1,
        band: "within",
        coverage: "covered",
        concepts: [{ concept: "api", state: "demonstrated" }],
        by: "person",
      },
    ],
  },
});

const CONCEPTS = JSON.stringify({
  data: {
    schema: "finitemonkey/concept-evidence@1",
    concepts: [
      { concept: "api", domain: "backend", state: "demonstrated", positive: 3, negative: 0, exposures: 2 },
      { concept: "webhook", domain: "backend", state: "beyond", positive: 0, negative: 0, exposures: 4 },
    ],
  },
});

const world = (on: StubOn, surfaces: readonly string[], runs: string[][], opened: string[]): void => {
  mock.clock(on);
  on("session.root", () => ({ value: ROOT }));
  on("session.surfaces", () => ({ value: surfaces }));
  on("ui.open", (_api, e) => {
    opened.push(String(e["id"]));
    return { value: { isPlaced: true } };
  });
  on("ui.close", () => ({ value: undefined }));
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  on("process.run", (_api, e) => {
    const args = (Array.isArray(e["argv"]) ? e["argv"].map(String) : []).slice(2);
    runs.push(args);
    const stdout = args[0] === "xray" && args[1] === "--json" ? XRAY : args[0] === "conceitos" ? CONCEPTS : "{}";
    return { value: { exitCode: 0, stdout, stderr: "" } };
  });
};

const pane = (surface: string): Readonly<Record<string, unknown>> => ({
  plugin: "finitemonkey",
  component: "Pane",
  requestId: "fm-xray",
  surface,
  viewport: { columns: 120, rows: 30 },
  props: {
    title: "Finite Monkey · x-ray",
    isFocused: false,
    bodyColumns: 110,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
});

describe("x-ray pane", () => {
  test("the terminal lists beyond × no criterion first, with actions, and the record as text", async ($, on) => {
    const runs: string[][] = [];
    const opened: string[] = [];
    world(on, ["terminal"], runs, opened);
    await $.command.run({ command: "fm", args: "xray" });
    expect(opened).toEqual(["fm-xray"]);
    const drawn = await $.ui.mount(pane("terminal"));
    expect(
      await drawn.find({
        type: "Text",
        text: "src/webhook.ts 10-12: beyond the evidence on record, no executable criterion (webhook; written by the agent)",
      }),
    ).toBeDefined();
    expect(
      await drawn.find({ type: "Text", text: "webhook (backend): beyond · 0 for, 0 against, 4 exposures" }),
    ).toBeDefined();
    await drawn.press({ key: "fm-xray-leave-src/webhook.ts:10" });
    expect(runs.at(-1)).toEqual(["xray", "decide", "src/webhook.ts:10", "--leave", "--json"]);
  });

  test("the desktop draws the record as an Svg map", async ($, on) => {
    world(on, ["desktop"], [], []);
    await $.command.run({ command: "fm", args: "xray" });
    const drawn = await $.ui.mount(pane("desktop"));
    expect(await drawn.find({ type: "Svg" })).toBeDefined();
  });

  test("in -p the x-ray comes back as text", async ($, on) => {
    world(on, [], [], []);
    const result = await $.command.run({ command: "fm", args: "xray" });
    expect(result.text).toMatch(/x-ray refund: 1 beyond the record with no criterion/);
  });
});
