import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, describe, it } from "node:test";

import { createTranslator } from "../src/i18n/translate.js";
import { resourcesOf, routesIn, scenariosFor } from "../src/scenarios/plan.js";
import { type HttpRequest, localUrl, runScenarios } from "../src/scenarios/run.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const t = createTranslator("en");

const server = (checkOwner: boolean): string =>
  [
    'const http = require("node:http");',
    "const routes = [];",
    "const app = {};",
    'for (const verb of ["get", "post", "patch", "delete"]) app[verb] = (path, handler) => routes.push([verb.toUpperCase(), path, handler]);',
    "const orders = new Map();",
    "let next = 1;",
    'const users = { "Bearer token-a": "a", "Bearer token-b": "b" };',
    "const allowed = (order, who) => " + (checkOwner ? "order.owner === who;" : "true;"),
    'app.post("/orders", (who) => { if (!who) return [401, {}]; const id = String(next++); orders.set(id, { id, owner: who }); return [201, { id }]; });',
    'app.get("/orders/:id", (who, order) => (!who ? [401, {}] : allowed(order, who) ? [200, order] : [404, {}]));',
    'app.patch("/orders/:id", (who, order) => (!who ? [401, {}] : allowed(order, who) ? [200, order] : [404, {}]));',
    'app.delete("/orders/:id", (who, order) => { if (!who) return [401, {}]; if (!allowed(order, who)) return [404, {}]; orders.delete(order.id); return [204, {}]; });',
    "http.createServer((req, res) => {",
    '  const who = users[req.headers.authorization ?? ""];',
    '  const [path, id] = req.url.startsWith("/orders/") ? ["/orders/:id", req.url.slice(8)] : [req.url, undefined];',
    "  const route = routes.find(([verb, at]) => verb === req.method && at === path);",
    "  const order = id === undefined ? undefined : orders.get(id);",
    "  const [status, body] = !route ? [404, {}] : id !== undefined && !order ? [404, {}] : route[2](who, order);",
    '  res.writeHead(status, { "content-type": "application/json" });',
    "  res.end(status === 204 ? undefined : JSON.stringify(body));",
    '}).listen(Number(process.env.PORT), "127.0.0.1");',
    "",
  ].join("\n");

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const CONTRACT = [
  "id: orders",
  "goal: customers see their orders",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node --version",
  "",
].join("\n");

const project = async (checkOwner: boolean): Promise<TempRepo> => {
  const repo = tempRepo({ "server.js": server(true) });
  repos.push(repo);
  const port = await freePort();
  write(
    repo.root,
    ".finitemonkey/config.yml",
    [
      "access:",
      "  start: node server.js",
      `  port: "${String(port)}"`,
      '  user_a: "authorization: Bearer token-a"',
      '  user_b: "authorization: Bearer token-b"',
      "",
    ].join("\n"),
  );
  write(repo.root, ".finitemonkey/policy.yml", "guards:\n  access-scenarios: active\n");
  trustContract(repo.root, "orders", CONTRACT);
  write(repo.root, "server.js", `${server(checkOwner)}// edited\n`);
  return repo;
};

const gateItem = async (repo: TempRepo): Promise<unknown> => {
  const gate = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime() });
  const items = field(gate.body, "data", "items");
  return Array.isArray(items) ? items.find((item: unknown) => field(item, "id") === "scenarios") : undefined;
};

const notesOf = (entry: unknown): readonly unknown[] => {
  const notes = field(entry, "notes");
  return Array.isArray(notes) ? notes : [];
};

const keys = (entry: unknown): readonly string[] => notesOf(entry).map((item) => String(field(item, "key")));

describe("two-user access scenarios", () => {
  it("generates create-as-A, read, change and delete as B, and read as anonymous from the routes", () => {
    const routes = routesIn("server.js", server(true));
    const [resource] = resourcesOf(routes);
    assert.ok(resource !== undefined);
    assert.equal(resource.name, "order");
    assert.deepEqual(
      scenariosFor(resource).map((item) => [item.kind, item.actor, item.method, item.allowed]),
      [
        ["owner_reads", "A", "get", true],
        ["other_reads", "B", "get", false],
        ["other_changes", "B", "patch", false],
        ["other_deletes", "B", "delete", false],
        ["anonymous_reads", "anonymous", "get", false],
      ],
    );
  });

  it("fails a scenario stated in product language when B can read A's order", async () => {
    const repo = await project(false);
    const entry = await gateItem(repo);
    assert.equal(field(entry, "status"), "failed", JSON.stringify(entry));
    const leak = notesOf(entry).find((item) => field(item, "key") === "gate.scenarios.fail.other_reads");
    assert.ok(leak !== undefined);
    const params = {
      resource: String(field(leak, "params", "resource")),
      status: String(field(leak, "params", "status")),
    };
    assert.equal(
      t("gate.scenarios.fail.other_reads", params),
      "failed: customer B cannot see customer A's order (status 200)",
    );
  });

  it("passes every scenario on the correct app", async () => {
    const repo = await project(true);
    const entry = await gateItem(repo);
    assert.equal(field(entry, "status"), "passed", JSON.stringify(entry));
    assert.equal(keys(entry).filter((key) => key.startsWith("gate.scenarios.pass.")).length, 5);
  });

  it("only talks to localhost", async () => {
    assert.ok(localUrl(4000, "/orders/1").startsWith("http://127.0.0.1:4000/"));
    const seen: HttpRequest[] = [];
    const [resource] = resourcesOf(routesIn("server.js", server(true)));
    assert.ok(resource !== undefined);
    await runScenarios(
      [resource],
      { start: undefined, port: 4000, userA: "authorization: a", userB: "authorization: b", body: "{}", idField: "id" },
      (request) => {
        seen.push(request);
        return Promise.resolve({ status: request.method === "post" ? 201 : 404, body: '{"id":"7"}' });
      },
    );
    assert.ok(seen.every((request) => request.path.startsWith("/orders")));
  });
});
