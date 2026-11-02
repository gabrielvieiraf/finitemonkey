import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import { sessionAccess } from "../src/look/session-access.js";
import { twoTenantTest } from "../src/scenarios/gen.js";
import { resourcesOf, routesIn } from "../src/scenarios/plan.js";
import { type HttpRequest, seedHttp, userHeaders } from "../src/scenarios/run.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SERVER = 'app.post("/orders", create);\napp.get("/orders/:id", show);\napp.delete("/orders/:id", drop);\n';
const TOKEN = "Bearer fake-token-a-000";
const CONFIG = {
  start: undefined,
  port: 4100,
  userA: `authorization: ${TOKEN}`,
  userB: "authorization: Bearer fake-token-b-000",
  body: '{"item":"book"}',
  idField: "id",
};

const project = (): Repo => {
  const repo = makeRepo({
    "server.js": SERVER,
    ".finitemonkey/config.yml": [
      "access:",
      '  port: "4100"',
      `  user_a: "authorization: ${TOKEN}"`,
      '  user_b: "authorization: Bearer fake-token-b-000"',
      "  flow_user: b",
      "",
    ].join("\n"),
  });
  repos.push(repo);
  return repo;
};

describe("two-tenant test: generated for approval", () => {
  it("writes every scenario with the same seed, talks to localhost and never embeds a user's header", () => {
    const text = twoTenantTest(resourcesOf(routesIn("server.js", SERVER)), CONFIG);
    assert.match(text, /http:\/\/127\.0\.0\.1:4100/);
    assert.match(text, /const seed = "\{\\"item\\":\\"book\\"\}";/);
    assert.match(text, /order\.other_reads/);
    assert.match(text, /order\.other_deletes/);
    assert.match(text, /order\.anonymous_reads/);
    assert.match(text, /FINITEMONKEY_USER_A/);
    assert.ok(!text.includes("fake-token"));
  });

  it("is proposed by anyone, written into the project only when the person approves it", async () => {
    const repo = project();
    const runtime = repoRuntime();
    const gen = await cliJson(["scenarios", "gen"], { runtime, cwd: repo.root });
    assert.equal(gen.code, 0, gen.stdout);
    const hash = String(field(gen.body, "data", "hash"));
    assert.ok(!existsSync(join(repo.root, "test/two-tenant.test.mjs")));
    const agent = await cliJson(["scenarios", "approve", "--hash", hash], {
      runtime,
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(agent.code, 0);
    assert.ok(!existsSync(join(repo.root, "test/two-tenant.test.mjs")));
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    const person = await cliJson(["scenarios", "approve", "--hash", hash], { runtime, cwd: repo.root, stdin: tty });
    assert.equal(person.code, 0, person.stdout);
    assert.match(readFileSync(join(repo.root, "test/two-tenant.test.mjs"), "utf8"), /two tenants: order/);
  });
});

describe("journeys and flows: the access seed and both users", () => {
  it("seeds one item per user through the same create route", async () => {
    const seen: HttpRequest[] = [];
    let next = 0;
    const seeded = await seedHttp(resourcesOf(routesIn("server.js", SERVER)), CONFIG, (request) => {
      seen.push(request);
      next += 1;
      return Promise.resolve({ status: 201, body: JSON.stringify({ id: next }) });
    });
    assert.deepEqual(seeded, [
      { resource: "order", actor: "A", id: "1" },
      { resource: "order", actor: "B", id: "2" },
    ]);
    assert.deepEqual(
      seen.map((request) => [request.method, request.path, request.headers["authorization"], request.body]),
      [
        ["post", "/orders", TOKEN, '{"item":"book"}'],
        ["post", "/orders", "Bearer fake-token-b-000", '{"item":"book"}'],
      ],
    );
    assert.deepEqual(userHeaders(CONFIG).B, { authorization: "Bearer fake-token-b-000" });
  });

  it("the browser sessions get both users and the flow user from the access config", () => {
    const repo = project();
    const access = sessionAccess(repoRuntime(), repo.root);
    assert.equal(access?.flowUser, "B");
    assert.deepEqual(access.users.A, { authorization: TOKEN });
  });
});
