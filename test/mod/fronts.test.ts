import { describe, expect, mock, type StubOn, test } from "claude-code/testing";

const ROOT = "/work";
const BOARD = {
  schema: "finitemonkey/fronts-board@1",
  rows: [
    { path: "/work", branch: "main", gate: "none", contract: null, lastActivity: null, waiting: false, files: [] },
    { path: "/w/a", branch: "front-a", gate: "green", contract: "t1", lastActivity: null, waiting: false, files: [] },
    { path: "/w/b", branch: "front-b", gate: "red", contract: "t2", lastActivity: null, waiting: true, files: [] },
  ],
  collisions: [{ file: "src/shared.js", branches: ["front-a", "front-b"] }],
};

const world = (on: StubOn, surfaces: readonly string[], opened: string[]): void => {
  mock.clock(on);
  on("session.root", () => ({ value: ROOT }));
  on("session.surfaces", () => ({ value: surfaces }));
  on("ui.open", (_api, e) => {
    opened.push(String(e["id"]));
    return { value: { isPlaced: true } };
  });
  on("ui.render", () => ({ type: "Text", props: {}, children: ["drawn by Claude Code"] }));
  on("process.run", (_api, e) => {
    const argv = Array.isArray(e["argv"]) ? e["argv"].map(String) : [];
    const ok = argv.includes("board");
    return { value: { exitCode: ok ? 0 : 1, stdout: ok ? JSON.stringify({ data: BOARD }) : "", stderr: "" } };
  });
};

const PANE = {
  plugin: "finitemonkey",
  component: "Pane",
  requestId: "fm-fronts",
  viewport: { columns: 100, rows: 30 },
  props: {
    title: "Finite Monkey · fronts",
    isFocused: false,
    bodyColumns: 80,
    placement: "inline",
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
};

describe("fronts board", () => {
  for (const surface of ["terminal", "vscode"] as const) {
    test(`three worktrees and a collision draw in the pane (${surface})`, async ($, on) => {
      const opened: string[] = [];
      world(on, [surface], opened);
      await $.command.run({ command: "fm", args: "fronts" });
      expect(opened).toEqual(["fm-fronts"]);
      const pane = await $.ui.mount({ ...PANE, surface });
      expect(await pane.find({ type: "Text", text: "●  front-a  gate ✓  contract t1" })).toBeUndefined();
      expect(await pane.find({ type: "Text", text: "● front-a  gate ✓  contract t1" })).toBeDefined();
      expect(await pane.find({ type: "Text", text: "◆ front-b  gate ✗  contract t2  WAITING ON YOU" })).toBeDefined();
      expect(await pane.find({ type: "Text", text: "collision: src/shared.js in front-a, front-b" })).toBeDefined();
    });
  }

  test("in -p the board comes back as text", async ($, on) => {
    world(on, [], []);
    const answer = await $.command.run({ command: "fm", args: "fronts" });
    expect(answer.text).toMatch(/^● main {2}gate · {2}contract -\n● front-a/);
  });
});
