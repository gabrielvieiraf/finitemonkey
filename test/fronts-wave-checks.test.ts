import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { recordContractChange } from "../src/fronts/contract-record.js";
import type { Front } from "../src/fronts/state.js";
import { touchedRoutes, waveGateChecks } from "../src/fronts/wave-checks.js";
import { execResult, fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath(join("/home", "ana", "app"));
const WAVE = toAbsolutePath(join("/home", "ana", "wave"));
const at = (dir: string, file: string): string => join(dir, file);

const front = (id: string, contract: string | null, paths: readonly string[] = []): Front => ({
  id,
  goal: id,
  contract,
  paths,
  append: [],
  i18nNs: null,
  worktree: null,
  path: null,
  branch: null,
  port: null,
  shotsPrefix: null,
  issue: null,
  agentId: null,
  agentKind: "general-purpose",
  status: "reported",
  blockedBy: [],
  inbox: [],
  lastReport: null,
  costUsd: 0,
  startedAt: null,
});

const LOOK = "port: 3000\nroutes:\n  - /\n  - /explore\n  - /checkout\n";

const waveRuntime = (policy: string | undefined, calls: ExecRequest[], failing = "") =>
  fakeRuntime({
    files: {
      [at(WAVE, ".finitemonkey/look.yml")]: LOOK,
      ...(policy === undefined ? {} : { [at(ROOT, ".finitemonkey/policy.yml")]: policy }),
    },
    git: (args) =>
      args[0] === "diff"
        ? { found: true, ok: true, stdout: "src/page/explore/index.tsx\nREADME.md\n" }
        : { found: false, ok: false, stdout: "" },
    exec: (request) => {
      calls.push(request);
      return request.args[0] === failing ? execResult(1, "{}") : execResult(0, "{}");
    },
  });

describe("wave merges check routes and contracts", () => {
  it("a screen file under a route's folder touches only that route; a shared one touches all", () => {
    const routes = ["/", "/explore", "/checkout"];
    assert.deepEqual(touchedRoutes(routes, ["src/page/explore/index.tsx"]), ["/explore"]);
    assert.deepEqual(touchedRoutes(routes, ["src/components/button.tsx"]), routes);
    assert.deepEqual(touchedRoutes(routes, []), []);
  });

  it("when active, runs the full gate per contract and look on the touched routes in the wave worktree", () => {
    const calls: ExecRequest[] = [];
    const runtime = waveRuntime("guards:\n  wave-checks: active\n", calls);
    const fronts = [front("a", "t1"), front("b", "t1"), front("c", null)];
    assert.equal(waveGateChecks(runtime, ROOT, WAVE, "base", fronts), undefined);
    assert.deepEqual(
      calls.map((call) => [call.cwd, ...call.args].join(" ")),
      [`${WAVE} gate --task t1 --json`, `${WAVE} look --json --route /explore`],
    );
  });

  it("a failing gate stops the wave with the command that failed", () => {
    const calls: ExecRequest[] = [];
    const runtime = waveRuntime("guards:\n  wave-checks: active\n", calls, "gate");
    assert.equal(
      waveGateChecks(runtime, ROOT, WAVE, "base", [front("a", "t1")]),
      "finitemonkey gate --task t1 --json: exit 1",
    );
  });

  it("in shadow, the default, nothing runs", () => {
    const calls: ExecRequest[] = [];
    assert.equal(waveGateChecks(waveRuntime(undefined, calls), ROOT, WAVE, "base", [front("a", "t1")]), undefined);
    assert.equal(calls.length, 0);
  });

  it("a contract change routed to a front writes its decision record", () => {
    const runtime = fakeRuntime();
    const task = recordContractChange(runtime, ROOT, front("a", "t1", ["src/a.ts"]), "price in cents");
    assert.match(task ?? "", /^t1-contract-\d{14}$/);
    const written = runtime.readText(
      toAbsolutePath(join(ROOT, ".finitemonkey", "decision-records", `${task ?? ""}.json`)),
    );
    assert.ok(written.ok);
    assert.match(written.value, /"class": "contract"[\s\S]*"detail": "a: price in cents"/);
    const off = fakeRuntime({ files: { [at(ROOT, ".finitemonkey/policy.yml")]: "guards:\n  decision-record: off\n" } });
    assert.equal(recordContractChange(off, ROOT, front("a", "t1"), "x"), undefined);
  });
});
