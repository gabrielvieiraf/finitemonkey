import assert from "node:assert/strict";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { type Front, FRONTS_FILE, serializeState } from "../src/fronts/state.js";
import { memoryFs } from "./memory-fs.js";
import { cliJson, execResult, fakeRuntime, field } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const WRITES = new Set(["issue comment", "project item-edit"]);

const front = (id: string, issue: number | null, status: Front["status"]): Front => ({
  id,
  goal: id,
  contract: null,
  paths: [`src/${id}/**`],
  append: [],
  i18nNs: null,
  worktree: id,
  path: null,
  branch: `front/${id}`,
  port: null,
  shotsPrefix: null,
  issue,
  agentId: null,
  agentKind: "subagent",
  status,
  blockedBy: [],
  inbox: [],
  lastReport: status === "verified" ? ".fm/reports/F1.json" : null,
  costUsd: 0,
  startedAt: null,
});

const STATE = serializeState({
  wave: 1,
  base: "main@abc1234",
  briefing: ".fm/briefing.md",
  maxConcurrent: 3,
  budgetUsd: null,
  budgetMinutes: null,
  fronts: [front("F1", 70, "verified"), front("F2", 71, "running"), front("F3", null, "planned")],
  pending: [],
});

const GH: Readonly<Record<string, string>> = {
  "repo view --json nameWithOwner": '{"nameWithOwner":"acme/app"}',
  "repo view --json owner": '{"owner":{"login":"acme"}}',
  "issue list": '[{"number":70,"title":"cart","state":"OPEN"},{"number":71,"title":"pay","state":"OPEN"}]',
  "project view": '{"id":"PVT_1"}',
  "project field-list": '{"fields":[{"id":"PVTF_front","name":"Front"},{"id":"PVTF_status","name":"Status"}]}',
  "project item-list":
    '{"items":[{"id":"PVTI_70","status":"Todo","content":{"type":"Issue","number":70,"title":"cart"}},{"id":"PVTI_71","content":{"type":"Issue","number":71,"title":"pay"}}]}',
};

const setup = (policy: string | undefined) => {
  const fs = memoryFs({
    [toAbsolutePath(join(PROJECT, FRONTS_FILE))]: STATE,
    ...(policy === undefined ? {} : { [toAbsolutePath(join(PROJECT, ".fm", "policy.yml"))]: policy }),
  });
  const calls: string[][] = [];
  const exec = (request: ExecRequest) => {
    if (request.command !== "gh") return undefined;
    calls.push([...request.args]);
    const key = Object.keys(GH).find((prefix) => request.args.join(" ").startsWith(prefix));
    return execResult(0, key === undefined ? "" : (GH[key] ?? ""));
  };
  return { runtime: fakeRuntime({ fs, exec }), calls };
};

const terminal = (answer: string): TextSource => Object.assign(Readable.from([answer]), { isTTY: true });

const writes = (calls: readonly string[][]): readonly string[][] =>
  calls.filter((args) => WRITES.has(args.slice(0, 2).join(" ")));

const ON = "guards:\n  fronts-github: active\n";

describe("fronts sync --github: writes only with the flag and a person's yes", () => {
  it("writes nothing while the fronts-github flag is off, even with a yes at a terminal", async () => {
    const { runtime, calls } = setup(undefined);
    const run = await cliJson(["fronts", "sync", "--github"], { cwd: PROJECT, runtime, stdin: terminal("y\n") });
    assert.equal(run.code, 0, run.stdout);
    assert.equal(field(run.body, "data", "github", "outcome"), "off");
    assert.deepEqual(writes(calls), []);
  });

  it("writes nothing without a terminal, or when the person says no", async () => {
    const piped = setup(ON);
    const headless = await cliJson(["fronts", "sync", "--github"], {
      cwd: PROJECT,
      runtime: piped.runtime,
      stdin: Readable.from(["y\n"]),
    });
    assert.equal(field(headless.body, "data", "github", "outcome"), "no-person");
    assert.deepEqual(writes(piped.calls), []);
    const asked = setup(ON);
    const no = await cliJson(["fronts", "sync", "--github"], {
      cwd: PROJECT,
      runtime: asked.runtime,
      stdin: terminal("n\n"),
    });
    assert.equal(field(no.body, "data", "github", "outcome"), "declined");
    assert.match(no.stderr, /Write to GitHub in acme\/app: comment on 2 issues\? \[y\/N\]/);
    assert.deepEqual(writes(asked.calls), []);
  });

  it("with the flag and a yes, comments on each linked issue and sets the project field once", async () => {
    const { runtime, calls } = setup(ON);
    const args = ["fronts", "sync", "--github", "--github-project", "3"];
    const run = await cliJson(args, { cwd: PROJECT, runtime, stdin: terminal("y\n") });
    assert.equal(field(run.body, "data", "github", "outcome"), "written", run.stdout);
    assert.match(run.stderr, /and set the Front field in project 3\? \[y\/N\]/);
    const done = writes(calls);
    assert.deepEqual(
      done.map((call) => call.slice(0, 3)),
      [
        ["issue", "comment", "70"],
        ["issue", "comment", "71"],
        ["project", "item-edit", "--id"],
        ["project", "item-edit", "--id"],
      ],
    );
    assert.match(done[0]?.[4] ?? "", /front F1 is verified\.\n\nLast report: \.fm\/reports\/F1\.json/);
    assert.deepEqual(done[2]?.slice(3), [
      "PVTI_70",
      "--project-id",
      "PVT_1",
      "--field-id",
      "PVTF_front",
      "--text",
      "F1: verified",
    ]);
    const again = await cliJson(["fronts", "sync", "--github"], { cwd: PROJECT, runtime, stdin: terminal("y\n") });
    assert.equal(field(again.body, "data", "github", "outcome"), "nothing");
    assert.equal(writes(calls).length, 4);
  });
});
