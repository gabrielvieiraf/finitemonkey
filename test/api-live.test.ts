import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { consistencyProblems } from "../src/apicontract/consistency.js";
import { liveOutcome, parseLive } from "../src/apicontract/gate-running-api.js";
import { parseRegistry } from "../src/apicontract/registry.js";
import { liveConfig, liveProblems, runLive } from "../src/apicontract/running-api.js";
import { parseShape } from "../src/apicontract/shape.js";
import type { ExecResult } from "../src/core/runtime.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import type { HttpAnswer, HttpRequest, Send } from "../src/scenarios/run.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const CONTRACT = `errors:
  - NOT_FOUND
error_shape_hint: none
endpoints:
  - id: getOrder
    method: GET
    path: /orders/:id
    summary: one order
    domain: orders
    output:
      id: string
    error:
      code: string
      message: string
  - id: listOrders
    method: GET
    path: /orders
    summary: orders
    domain: orders
    list: true
    input:
      cursor: string?
    error:
      code: string
      message: string
  - id: createOrder
    method: POST
    path: /orders
    summary: new order
    domain: orders
    input:
      total: number
    error:
      code: string
      message: string
`;

const registryOf = (source: string) => {
  const parsed = parseRegistry(source);
  if (!parsed.ok) throw new Error(parsed.error.join("; "));
  return parsed.value;
};

const fixtureApi =
  (answers: (request: HttpRequest) => HttpAnswer, seen: HttpRequest[] = []): Send =>
  (request) => {
    seen.push(request);
    return Promise.resolve(answers(request));
  };

const json = (status: number, body: unknown): HttpAnswer => ({ status, body: JSON.stringify(body) });

const consistentApi = (request: HttpRequest): HttpAnswer => {
  if (request.path.includes("finitemonkey-missing")) return json(404, { code: "NOT_FOUND", message: "no order" });
  if (request.method === "post" && request.body === "{}") return json(400, { code: "INVALID", message: "total" });
  if (request.method === "post") return json(201, { id: "o1" });
  if (request.path.startsWith("/api/orders/")) return json(200, { id: "1" });
  return json(200, { items: [], nextCursor: null });
};

describe("contract checked against the running API", () => {
  it("reports a second error shape in the running response though the contract file is consistent", async () => {
    const registry = registryOf(CONTRACT);
    const shape = parseShape(CONTRACT);
    assert.deepEqual(consistencyProblems(registry, shape), []);
    const drifting = (request: HttpRequest): HttpAnswer =>
      request.path.includes("finitemonkey-missing")
        ? json(404, { error: { code: "NOT_FOUND" } })
        : consistentApi(request);
    const calls = await runLive(registry, "/api", fixtureApi(drifting));
    const problems = liveProblems(registry, shape, calls);
    assert.deepEqual(
      problems.map((problem) => problem.kind),
      ["live_error_shapes"],
    );
    assert.match(JSON.stringify(problems), /\{error\}: getOrder/);
  });

  it("calls every declared operation with mock inputs on the configured base and stays quiet when it agrees", async () => {
    const registry = registryOf(CONTRACT);
    const seen: HttpRequest[] = [];
    const calls = await runLive(registry, "/api", fixtureApi(consistentApi, seen));
    assert.deepEqual(liveProblems(registry, parseShape(CONTRACT), calls), []);
    assert.deepEqual(
      seen.map((request) => `${request.method} ${request.path} ${request.body ?? ""}`.trim()),
      [
        "get /api/orders/1",
        "get /api/orders/finitemonkey-missing-0",
        "get /api/orders",
        'post /api/orders {"total":1}',
        "post /api/orders {}",
      ],
    );
  });

  it("reports a declared error shape the running API does not use, and a list that does not page", async () => {
    const source = CONTRACT.replace("error_shape_hint: none\n", "error_shape:\n  code: string\n  message: string\n");
    const registry = registryOf(source);
    const answers = (request: HttpRequest): HttpAnswer => {
      if (request.path === "/orders") return request.method === "get" ? json(200, []) : json(422, { detail: "x" });
      return consistentApi(request);
    };
    const calls = await runLive(registry, "", fixtureApi(answers));
    assert.deepEqual(liveProblems(registry, parseShape(source), calls), [
      { kind: "live_error_shape_mismatch", id: "createOrder", shape: "{detail}", declared: "{code,message}" },
      { kind: "live_pagination", id: "listOrders", scheme: "token" },
    ]);
  });

  it("reads api: port, start and base from the project config", () => {
    assert.equal(liveConfig({}), undefined);
    assert.deepEqual(liveConfig({ api: { port: "8080", start: "npm start", base: "/api/v1/" } }), {
      port: 8080,
      start: "npm start",
      base: "/api/v1",
    });
  });
});

const repoWith = (files: Readonly<Record<string, string>>): Repo => {
  const repo = makeRepo(files);
  cleanups.push(repo.cleanup);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "api",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [],
    tests: undefined,
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  return repo;
};

const contextWith = (repo: Repo, execSelf: (args: readonly string[]) => ExecResult): GateContext => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(ready.kind);
  const ctx = ready.prepared.ctx;
  return { ...ctx, trusted: true, runtime: { ...ctx.runtime, execSelf } };
};

const ran = (live: readonly unknown[]): ExecResult => ({
  found: true,
  exitCode: 0,
  stdout: `${JSON.stringify({ schemaVersion: 1, data: { ran: true, live, calls: [], contractProblems: 0 } })}\n`,
  stderr: "",
  timedOut: false,
  durationMs: 1,
});

describe("gate contract check, running API", () => {
  const SECOND_SHAPE = { kind: "live_error_shapes", shapes: "{code,message}: listOrders; {error}: getOrder" };

  it("asks for the running response only when api: port is configured", () => {
    const asked: string[] = [];
    const repo = repoWith({ "api/contract.yml": CONTRACT });
    const outcome = liveOutcome(
      contextWith(repo, (args) => {
        asked.push(args.join(" "));
        return ran([]);
      }),
    );
    assert.deepEqual(outcome, { notes: [], blocking: false });
    assert.deepEqual(asked, []);
  });

  it("lists a running error shape in shadow and blocks once api-consistency is active", () => {
    const repo = repoWith({ "api/contract.yml": CONTRACT, ".finitemonkey/config.yml": "api:\n  port: 4010\n" });
    const shadow = liveOutcome(contextWith(repo, () => ran([SECOND_SHAPE])));
    assert.equal(shadow.blocking, false);
    assert.deepEqual(
      shadow.notes.map((note) => note.key),
      ["gate.contract.api_shadow", "gate.contract.api.live_error_shapes"],
    );
    repo.write(".finitemonkey/policy.yml", "guards:\n  api-consistency: active\n");
    const active = liveOutcome(contextWith(repo, () => ran([SECOND_SHAPE])));
    assert.equal(active.blocking, true);
  });

  it("fails closed when active and the running API cannot be called", () => {
    const repo = repoWith({
      "api/contract.yml": CONTRACT,
      ".finitemonkey/config.yml": "api:\n  port: 4010\n",
      ".finitemonkey/policy.yml": "guards:\n  api-consistency: active\n",
    });
    const outcome = liveOutcome(contextWith(repo, () => ({ ...ran([]), stdout: "garbage" })));
    assert.deepEqual(outcome, { notes: [{ key: "gate.contract.live.not_run", params: {} }], blocking: true });
    assert.equal(parseLive('{"data":{"ran":false,"live":[]}}'), undefined);
  });
});
