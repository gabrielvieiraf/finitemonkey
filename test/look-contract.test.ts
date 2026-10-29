import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";

import { EMPTY_BASELINE } from "../src/findings/baseline.js";
import {
  approveUi,
  contractStates,
  parseUiContract,
  proposeUi,
  uiContractState,
  uiHash,
} from "../src/look/contract.js";
import { dontIssues, type DontRule } from "../src/look/dont.js";
import { governUx } from "../src/look/ux-govern.js";
import { fmPaths } from "../src/task/paths.js";
import { fixtureRepo, hasBrowser, lookAt } from "./look-fixture.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

const CONTRACT = [
  "ui:",
  "  - screen: /orders",
  "    primary_action:",
  "      role: button",
  "      name: Create order",
  "    states: [ideal, empty, error]",
  "    mocks:",
  "      empty: no-orders",
  "    back: /",
  "    steps_max: 3",
  "",
].join("\n");

const tty = (): Readable => Object.assign(Readable.from([]), { isTTY: true });

describe("ui contract: schema and approval", () => {
  it("validates against the schema and rejects unknown keys", () => {
    const parsed = parseUiContract(CONTRACT);
    assert.ok(parsed.ok);
    assert.equal(parsed.value[0]?.primaryAction?.name, "Create order");
    const unknown = parseUiContract("ui:\n  - screen: /a\n    colour: red\n");
    assert.ok(!unknown.ok);
    assert.deepEqual(unknown.error, ["$.ui[0].colour: unknown key"]);
    const state = parseUiContract("ui:\n  - screen: /a\n    states: [sleepy]\n");
    assert.ok(!state.ok);
    assert.deepEqual(parseUiContract("screens: []\n").ok, false);
  });

  it("approval is bound to the block hash and editing the block invalidates it", () => {
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    assert.ok(proposeUi(runtime, paths, "t1", CONTRACT).ok);
    assert.equal(uiContractState(runtime, paths, "t1").approved, false);
    const wrong = approveUi(runtime, paths, "t1", "0000000000000000");
    assert.ok(!wrong.ok && wrong.error === "hash");
    assert.ok(approveUi(runtime, paths, "t1", uiHash(CONTRACT)).ok);
    assert.equal(uiContractState(runtime, paths, "t1").approved, true);
    assert.ok(proposeUi(runtime, paths, "t1", CONTRACT.replace("steps_max: 3", "steps_max: 4")).ok);
    const edited = uiContractState(runtime, paths, "t1");
    assert.equal(edited.approved, false);
    assert.notEqual(edited.hash, edited.approvedHash);
  });

  it("the agent can propose but not approve; the person approves by hash", async () => {
    const repo = makeRepo({ "README.md": "x\n", "draft.yml": CONTRACT });
    repos.push(repo);
    const runtime = repoRuntime();
    const proposed = await cliJson(["ui", "propose", "t1", "--from", "draft.yml"], { runtime, cwd: repo.root });
    assert.equal(proposed.code, 0, proposed.stdout);
    const hash = String(field(proposed.body, "data", "hash"));
    const agent = await cliJson(["ui", "approve", "t1", "--hash", hash], {
      runtime,
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(agent.code, 0);
    const person = await cliJson(["ui", "approve", "t1", "--hash", hash], { runtime, cwd: repo.root, stdin: tty() });
    assert.equal(person.code, 0, person.stdout);
    assert.equal(field(person.body, "data", "approved"), true);
  });

  it("contract states without a mock stay uncovered", () => {
    const parsed = parseUiContract(CONTRACT);
    assert.ok(parsed.ok);
    assert.deepEqual(contractStates(parsed.value, {})["/orders"], [
      { state: "ideal", mock: undefined },
      { state: "empty", mock: "no-orders" },
      { state: "error", mock: undefined },
    ]);
  });
});

const RULE: DontRule = {
  id: "D1",
  reason: "no glass cards",
  by: "Ana",
  at: "2026-10-29T00:00:00.000Z",
  source: "message",
  predicate: { selector: ".card", property: "backdrop-filter", op: "matches", value: "blur" },
};

describe("ui contract: standing don't rules", () => {
  it("a text-only rejection is reported as not verified, a retired rule is not evaluated", () => {
    const text: DontRule = { id: "D2", reason: "less corporate", by: "Ana", at: RULE.at, source: "message" };
    const found = dontIssues([RULE, text], [], true);
    assert.deepEqual(
      found.map((item) => [item.rule, item.unverified === true]),
      [["ui/dont", true]],
    );
    const retired = { ...RULE, retired: { at: RULE.at, by: "Ana", reason: "brand changed" } };
    const hit = { id: "D1", sel: ".card", actual: "blur(8px)", x: 0, y: 0, w: 10, h: 10 };
    assert.deepEqual(dontIssues([retired], [hit], true), []);
    assert.equal(dontIssues([RULE], [hit], true).length, 1);
  });

  it("in shadow mode don't findings are logged and never block", () => {
    const issues = dontIssues([RULE], [{ id: "D1", sel: ".card", actual: "blur(8px)", x: 0, y: 0, w: 1, h: 1 }], true);
    const governed = governUx({
      pages: [{ feature: "ui-contract", route: "/", viewport: 1440, issues }],
      modes: { "ui-contract": "shadow" },
      baseline: EMPTY_BASELINE,
      now: RULE.at,
      muted: () => false,
    });
    assert.equal(governed.records.length, 1);
    assert.ok(governed.findings.every((item) => !item.blocking));
  });

  it("the person records and retires a rejection, and the retirement is in the ledger", async () => {
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const options = { runtime, cwd: repo.root, stdin: tty() };
    const added = await cliJson(
      [
        "ui",
        "dont",
        "add",
        "--reason",
        "no glass cards",
        "--selector",
        ".card",
        "--property",
        "backdrop-filter",
        "--matches",
        "blur",
      ],
      options,
    );
    assert.equal(added.code, 0, added.stdout);
    const retired = await cliJson(["ui", "dont", "retire", "D1", "--reason", "brand changed"], options);
    assert.equal(retired.code, 0, retired.stdout);
    assert.ok(repo.read(".finitemonkey/log.jsonl").includes("ui.dont_retired"));
    const agent = await cliJson(["ui", "dont", "add", "--reason", "x"], {
      runtime,
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(agent.code, 0);
  });
});

describe("ui contract: a rejected pattern comes back", () => {
  it("a later version that brings the rejected style back cites the rejection", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fixtureRepo(
      {
        "/": '<main><div class="card" style="padding:16px">Plain card</div></main>',
        "/glass": '<main><div class="card" style="padding:16px;backdrop-filter:blur(8px)">Glass card</div></main>',
      },
      {
        routes: ["/", "/glass"],
        policy: "guards:\n  a11y: off\n  keyboard: off\n  ui-states: off\n",
        files: {
          ".finitemonkey/look/dont.json": JSON.stringify({ schema: "finitemonkey/look-dont@1", rules: [RULE] }),
        },
      },
    );
    repos.push(repo);
    const run = await lookAt(repo);
    const dont = run.summary.findings.filter((item) => item.rule === "ui/dont");
    assert.deepEqual([...new Set(dont.map((item) => item.route))], ["/glass"]);
    assert.ok(dont.every((item) => item.detail.includes("D1") && item.detail.includes("no glass cards")));
    assert.ok(dont.every((item) => !item.blocking));
  });
});
