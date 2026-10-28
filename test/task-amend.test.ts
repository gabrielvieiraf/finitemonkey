import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { readLedger } from "../src/evidence/ledger.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { contractHash, parseContract } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, readTrust, writeState, writeTrust } from "../src/task/state.js";
import { makeRepo, NO_PR, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, reasonText, stdinFrom } from "./support.js";

const repos: Repo[] = [];
const dirs: string[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const counter = (dir: string, name: string): string =>
  `node -e "require('fs').appendFileSync(process.argv[1], 'x')" ${join(dir, name).replace(/\\/g, "/")}`;

const runs = (dir: string, name: string): number => {
  try {
    return readFileSync(join(dir, name), "utf8").length;
  } catch {
    return 0;
  }
};

const setup = () => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n" });
  repos.push(repo);
  const dir = mkdtempSync(join(tmpdir(), "fm-runs-"));
  dirs.push(dir);
  const text = [
    "id: t1",
    "goal: pay with Pix",
    "acceptance:",
    "  - id: A1",
    "    check: command",
    `    run: ${JSON.stringify(counter(dir, "a1"))}`,
    "  - id: A2",
    "    check: command",
    `    run: ${JSON.stringify(counter(dir, "a2"))}`,
    "",
  ].join("\n");
  const parsed = parseContract("t1", text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  runtime.writeText(paths.task("t1"), text);
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, t1: contractHash(parsed.value) },
    approved: { ...lock.approved, t1: text },
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: "t1" });
  return { repo, dir };
};

const hook = (repo: Repo, event: "PreToolUse" | "UserPromptSubmit", payload: object) =>
  runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: repo.root, ...payload })),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: toAbsolutePath(repo.root),
    t: createTranslator("en"),
    startTimer: repoRuntime().startTimer,
    runtime: repoRuntime({ gh: NO_PR }),
    env: {},
  });

describe("task reopen", () => {
  it("rechecks only the reopened criteria; evidence for the others stays valid", async () => {
    const { repo, dir } = setup();
    const gate = () => cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime({ gh: NO_PR }) });
    assert.equal((await gate()).code, 0);
    assert.equal((await gate()).code, 0);
    assert.deepEqual([runs(dir, "a1"), runs(dir, "a2")], [1, 1]);
    const before = readLedger(repoRuntime(), fmPaths(repo.root).evidence("t1")).filter((entry) => entry.check === "A1");
    const reopened = await cliJson(["task", "reopen", "t1", "A2"], {
      cwd: repo.root,
      runtime: repoRuntime({ gh: NO_PR }),
    });
    assert.equal(reopened.code, 0, JSON.stringify(reopened.body));
    assert.deepEqual([runs(dir, "a1"), runs(dir, "a2")], [1, 2]);
    const afterA1 = readLedger(repoRuntime(), fmPaths(repo.root).evidence("t1")).filter(
      (entry) => entry.check === "A1",
    );
    assert.deepEqual(afterA1, before);
    const unknown = await cliJson(["task", "reopen", "t1", "A9"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(unknown.code, 2);
  });
});

describe("task amend", () => {
  it("rejects an amendment without a reason or evidence", async () => {
    const { repo } = setup();
    const noReason = await cliJson(["task", "amend", "A2", "--run", "node -e 0", "--evidence", "ci log"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(noReason.code, 2);
    assert.equal(field(noReason.body, "error", "code"), "invalid_arguments");
    const noEvidence = await cliJson(["task", "amend", "A2", "--run", "node -e 0", "--reason", "flaky"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(noEvidence.code, 2);
  });

  it("the model cannot amend through Bash; the person's amendment counts after their trust and records who and when", async () => {
    const { repo } = setup();
    const blocked = await hook(repo, "PreToolUse", {
      tool_name: "Bash",
      tool_input: {
        command: 'npx finitemonkey task amend A2 --run "node -e 0" --reason "too slow" --evidence "ci log"',
      },
    });
    assert.equal(blocked.verdict, "block");
    assert.match(reasonText(blocked), /changes the done contract, which only the person can do/);
    const amended = await cliJson(
      [
        "task",
        "amend",
        "A2",
        "--run",
        "node -e 0",
        "--reason",
        "the old check timed out on CI",
        "--evidence",
        "run 123 log",
      ],
      { cwd: repo.root, runtime: repoRuntime() },
    );
    assert.equal(amended.code, 0, JSON.stringify(amended.body));
    assert.equal(amended.body["next"], "fm: trust t1");
    const gate = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime({ gh: NO_PR }) });
    assert.equal(field(gate.body, "data", "contractEdited"), true);
    await hook(repo, "UserPromptSubmit", { prompt: "fm: trust t1" });
    const lines = repo.read(".finitemonkey/tasks/amendments.jsonl").trim().split("\n");
    const last = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;
    assert.equal(last["criterion"], "A2");
    assert.equal(last["reason"], "the old check timed out on CI");
    assert.match(String(last["approvedBy"]), /^person@/);
    assert.equal(typeof last["approvedAt"], "string");
    const trusted = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime({ gh: NO_PR }) });
    assert.equal(field(trusted.body, "data", "contractEdited"), false);
  });
});
