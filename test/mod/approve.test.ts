import { describe, expect, mock, type StubOn, test } from "claude-code/testing";

const ROOT = "/work";
const HASH = "c7f2a91e00001111";
const DIGEST = "d1d2d3";

const contract = (trusted: boolean): string =>
  JSON.stringify({
    data: {
      schema: "finitemonkey/task@1",
      task: "refund",
      goal: "refunds go back to the card",
      hash: HASH,
      digest: DIGEST,
      trusted,
      acceptance: [{ id: "C1", says: "npm test" }],
      examples: [
        { id: "E1", status: "approved", says: "a refund of 50 returns to the card" },
        { id: "E2", status: "proposed", says: "a cancelled order refuses a refund" },
      ],
    },
  });

const QUESTION = JSON.stringify({
  data: {
    schema: "finitemonkey/task@1",
    task: "refund",
    question: {
      task: "refund",
      input: "-5",
      options: [
        { letter: "A", output: "nothing to refund" },
        { letter: "B", output: "error: negative amount" },
      ],
    },
  },
});

interface World {
  readonly runs: string[][];
  readonly opened: string[];
  trusted: boolean;
}

const world = (on: StubOn, surfaces: readonly string[]): World => {
  const state: World = { runs: [], opened: [], trusted: false };
  mock.clock(on);
  on("session.root", () => ({ value: ROOT }));
  on("session.surfaces", () => ({ value: surfaces }));
  on("ui.open", (_api, e) => {
    state.opened.push(String(e["id"]));
    return { value: { isPlaced: true } };
  });
  on("ui.close", () => ({ value: undefined }));
  on("ui.log", () => ({ value: undefined }));
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  on("process.run", (_api, e) => {
    const argv = Array.isArray(e["argv"]) ? e["argv"].map(String) : [];
    const args = argv.slice(2);
    state.runs.push(args);
    if (args.includes("--hash")) state.trusted = true;
    const stdout = args[1] === "trust" ? contract(state.trusted) : args.includes("--pending") ? QUESTION : "{}";
    return { value: { exitCode: 0, stdout, stderr: "" } };
  });
  return state;
};

const pane = (requestId: string, surface: string): Readonly<Record<string, unknown>> => ({
  plugin: "finitemonkey",
  component: "Pane",
  requestId,
  surface,
  viewport: { columns: 100, rows: 30 },
  props: {
    title: "Finite Monkey",
    isFocused: false,
    bodyColumns: 80,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
});

const approvals = (runs: readonly string[][]): readonly string[][] =>
  runs.filter((args) => args.includes("--hash") || args.includes("--approve") || args.includes("--choose"));

describe("approval by button", () => {
  for (const surface of ["terminal", "vscode", "desktop"] as const) {
    test(`Approve sends the exact hash and digest that were shown (${surface})`, async ($, on) => {
      const state = world(on, [surface]);
      await $.command.run({ command: "fm", args: "contract" });
      expect(state.opened).toEqual(["fm-contract"]);
      expect(approvals(state.runs)).toEqual([]);
      const drawn = await $.ui.mount(pane("fm-contract", surface));
      expect(await drawn.find({ type: "Text", text: "Contract refund: refunds go back to the card" })).toBeDefined();
      expect(
        await drawn.find({ type: "Text", text: "E1 [approved] a refund of 50 returns to the card" }),
      ).toBeDefined();
      await drawn.press({ key: "fm-contract-approve" });
      expect(approvals(state.runs)).toEqual([
        ["task", "trust", "refund", "--hash", HASH, "--digest", DIGEST, "--json"],
      ]);
    });
  }

  test("a proposed example is approved by its own button", async ($, on) => {
    const state = world(on, ["terminal"]);
    await $.command.run({ command: "fm", args: "contract" });
    const drawn = await $.ui.mount(pane("fm-contract", "terminal"));
    await drawn.press({ key: "fm-ex-approve-E2" });
    expect(approvals(state.runs)).toEqual([["task", "examples", "refund", "--approve", "E2", "--json"]]);
  });

  test("the divergence pane stores a letter or the person's own answer through the CLI", async ($, on) => {
    const state = world(on, ["terminal"]);
    await $.command.run({ command: "fm", args: "diverge" });
    expect(state.opened).toEqual(["fm-diverge"]);
    const drawn = await $.ui.mount(pane("fm-diverge", "terminal"));
    expect(await drawn.find({ type: "Code", text: "error: negative amount" })).toBeDefined();
    await drawn.press({ key: "fm-diverge-B" });
    expect(state.runs.at(-2)).toEqual(["task", "diverge", "refund", "--choose", "B", "--json"]);
    await drawn.unmount();
    const again = await $.ui.mount(pane("fm-diverge", "terminal"));
    await again.input({ key: "fm-diverge-want", text: "refund refused" });
    expect(state.runs.at(-2)).toEqual(["task", "diverge", "refund", "--want", "refund refused", "--json"]);
  });

  test("in -p nothing is approved and the terminal path is printed", async ($, on) => {
    const state = world(on, []);
    const result = await $.command.run({ command: "fm", args: "contract" });
    expect(result.text).toMatch(/fm: trust refund/);
    const asked = await $.command.run({ command: "fm", args: "diverge" });
    expect(asked.text).toMatch(/--choose <letter>/);
    expect(approvals(state.runs)).toEqual([]);
    expect(state.opened).toEqual([]);
  });
});
