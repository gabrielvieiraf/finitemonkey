import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { JsonObject } from "../src/core/parsed.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { approveUi, parseUiContract, proposeUi, uiContractState } from "../src/look/contract.js";
import { approvedSheets } from "../src/look/node-sheet-pass.js";
import { projectRelative } from "../src/look/paths.js";
import type { ProbeNode } from "../src/look/probe.js";
import { buildSheet, diffSheets, type Sheet, Z_INDEX } from "../src/look/sheet.js";
import { approveSheetInContract, sheetHash, sheetRefs, withSheetEntry } from "../src/look/sheet-contract.js";
import { renderSheet } from "../src/look/sheet-render.js";
import { approvedSheetPath } from "../src/look/sheet-store.js";
import { EMPTY_TOKENS } from "../src/look/tokens.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, writeState } from "../src/task/state.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { field, parseBody, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const probeNode = (sel: string, parent: number, overrides: Partial<ProbeNode> = {}): ProbeNode => ({
  parent,
  sel,
  tag: "div",
  role: "",
  name: "",
  text: "",
  visible: true,
  interactive: false,
  field: false,
  labelled: true,
  placeholder: "",
  inline: false,
  native: false,
  alt: null,
  x: 0,
  y: 0,
  w: 300,
  h: 100,
  color: "rgb(0, 0, 0)",
  bg: "rgba(0, 0, 0, 0)",
  bgImage: "none",
  opacity: 1,
  fontSize: 16,
  fontWeight: 400,
  fontFamily: "sans-serif",
  lineHeight: 0,
  radius: 0,
  shadow: "none",
  borderColor: "rgb(0, 0, 0)",
  borderWidth: 0,
  spacing: [0, 0, 0, 0, 8, 8, 8, 8, 0, 0],
  position: "static",
  zIndex: "auto",
  isolates: false,
  clipped: false,
  live: false,
  ...overrides,
});

const sheetWith = (overlay: Partial<ProbeNode>, tree = "t1"): Sheet =>
  buildSheet({
    route: "/card",
    selector: ".card",
    tree,
    tokens: EMPTY_TOKENS,
    views: [
      {
        width: 390,
        state: "ideal",
        root: ".card",
        probe: {
          scrollWidth: 390,
          clientWidth: 390,
          lang: "en",
          truncated: false,
          nodes: [probeNode(".card", -1), probeNode(".overlay", 0, overlay)],
        },
      },
    ],
  });

describe("sheet: z-index and stacking contexts", () => {
  it("a z-index change shows in the sheet diff", () => {
    const before = sheetWith({ position: "absolute", zIndex: "10" });
    const after = sheetWith({ position: "absolute", zIndex: "20" }, "t2");
    assert.deepEqual(
      diffSheets(before, after).filter((change) => change.property === "z-index"),
      [{ width: 390, state: "ideal", key: ".overlay", property: "z-index", from: 10, to: 20 }],
    );
  });

  it("marks stacking contexts and shows z-index in the layers column", () => {
    const sheet = sheetWith({ position: "absolute", zIndex: "10" });
    const overlay = sheet.views[0]?.elements.find((element) => element.key === ".overlay");
    assert.ok(overlay !== undefined);
    assert.equal(overlay.stacking, true);
    assert.equal(overlay.values[Z_INDEX], 10);
    assert.equal(sheetWith({ isolates: true }).views[0]?.elements[1]?.stacking, true);
    assert.equal(sheetWith({}).views[0]?.elements[1]?.stacking, false);
    assert.ok(renderSheet(sheet).includes("absolute · z 10 · stacking"));
  });

  it("an approved sheet without z-index does not report a z-index change", () => {
    const now = sheetWith({ position: "absolute", zIndex: "10" }, "t2");
    const legacy: Sheet = {
      ...now,
      views: now.views.map((view) => ({
        ...view,
        elements: view.elements.map((element) => ({
          ...element,
          values: Object.fromEntries(Object.entries(element.values).filter(([name]) => name !== "z-index")),
        })),
      })),
    };
    assert.deepEqual(diffSheets(legacy, now), []);
  });
});

const CONTRACT = "ui:\n  - screen: /card\n    primary_action:\n      role: button\n      name: Save\n";

const activeRepo = (policy = ""): Repo => {
  const repo = makeRepo(policy === "" ? {} : { ".finitemonkey/policy.yml": policy });
  repos.push(repo);
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  writeState(runtime, paths, { ...readState(runtime, paths), active: "t1" });
  return repo;
};

const approveSheet = (repo: Repo, sheet: Sheet) => {
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  const text = `${JSON.stringify(sheet, null, 2)}\n`;
  const file = projectRelative(paths, approvedSheetPath(paths, "/card"));
  repo.write(file, text);
  return approveSheetInContract(runtime, paths, "t1", {
    route: "/card",
    selector: ".card",
    file,
    hash: sheetHash(text),
    variables: sheet.variables.length,
  });
};

describe("sheet: inside the UI contract", () => {
  it("approving the sheet writes a sheets entry and changes the contract hash", () => {
    const repo = activeRepo();
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    assert.ok(proposeUi(runtime, paths, "t1", CONTRACT).ok);
    assert.ok(approveUi(runtime, paths, "t1", undefined).ok);
    const before = uiContractState(runtime, paths, "t1");
    const done = approveSheet(repo, sheetWith({ position: "absolute", zIndex: "10" }));
    assert.ok(done.ok);
    const after = uiContractState(runtime, paths, "t1");
    assert.notEqual(after.hash, before.hash);
    assert.equal(done.value.contractHash, after.hash);
    assert.equal(after.approved, true);
    assert.deepEqual(after.errors, []);
    const source = repo.read(".finitemonkey/tasks/t1/ui.yml");
    assert.ok(source.startsWith(CONTRACT.trimEnd()));
    assert.deepEqual(
      sheetRefs(source).map((ref) => ref.route),
      ["/card"],
    );
  });

  it("re-approving replaces the entry for the same route and keeps the contract valid", () => {
    const first = withSheetEntry(undefined, {
      route: "/a",
      selector: "main",
      file: "a.json",
      hash: "h1",
      variables: 1,
    });
    const second = withSheetEntry(first, { route: "/a", selector: "main", file: "a.json", hash: "h2", variables: 2 });
    const third = withSheetEntry(second, { route: "/b", selector: "main", file: "b.json", hash: "h3", variables: 0 });
    assert.ok(parseUiContract(third).ok);
    assert.deepEqual(
      sheetRefs(third).map((ref) => `${ref.route} ${ref.hash}`),
      ["/a h2", "/b h3"],
    );
  });

  it("a sheet edited after approval no longer counts as approved", () => {
    const repo = activeRepo();
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    assert.ok(approveSheet(repo, sheetWith({})).ok);
    assert.deepEqual(Object.keys(approvedSheets(runtime, paths, ["/card"])), ["/card"]);
    repo.write(
      projectRelative(paths, approvedSheetPath(paths, "/card")),
      `${JSON.stringify(sheetWith({}, "edited"), null, 2)}\n`,
    );
    assert.deepEqual(Object.keys(approvedSheets(runtime, paths, ["/card"])), []);
  });
});

const prompt = (repo: Repo): Promise<HookOutcome> => {
  const runtime = repoRuntime();
  const payload: JsonObject = { hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: repo.root, prompt: "go" };
  return runHook("UserPromptSubmit", {
    stdin: stdinFrom(JSON.stringify(payload)),
    deadlineMs: 20_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const context = (outcome: HookOutcome): string => {
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

describe("sheet: delivered at the next prompt", () => {
  it("with ui-sheet active the sheet path and summary are injected once", async () => {
    const repo = activeRepo("guards:\n  ui-sheet: active\n");
    assert.ok(approveSheet(repo, sheetWith({ position: "absolute", zIndex: "10" })).ok);
    const first = context(await prompt(repo));
    assert.ok(first.includes("Approved component sheet for /card (.card): .finitemonkey/look/sheets/"), first);
    assert.ok(first.includes("S1 8px"), first);
    assert.ok(!context(await prompt(repo)).includes("Approved component sheet"));
  });

  it("in shadow nothing is injected and the would-be delivery is logged", async () => {
    const repo = activeRepo();
    assert.ok(approveSheet(repo, sheetWith({})).ok);
    assert.ok(!context(await prompt(repo)).includes("Approved component sheet"));
    const log = repo.read(".finitemonkey/log.jsonl");
    assert.ok(log.includes('"feature_shadow"') && log.includes('"ui-sheet"'), log);
  });
});
