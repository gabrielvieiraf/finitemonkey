import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const pkg = (deps: Readonly<Record<string, string>>): string =>
  `${JSON.stringify({ name: "app", dependencies: deps }, null, 2)}\n`;

const contract = (extra = ""): string =>
  `id: work\ngoal: send renewal emails\nscope:\n  paths: [src/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n${extra}`;

const context = (stage: string, origin: string, demonstrated: readonly string[] = []): string =>
  [
    "context:",
    "  stage:",
    `    value: ${stage}`,
    `    origin: ${origin}`,
    ...(demonstrated.length === 0
      ? []
      : ["  demonstrated:", `    value: [${demonstrated.join(", ")}]`, "    origin: stated"]),
    "",
  ].join("\n");

const setup = (goals: string, extra = ""): Repo => {
  const repo = makeRepo({
    "package.json": pkg({ express: "^4.19.0" }),
    ".finitemonkey/goals.yml": goals,
    ".finitemonkey/tasks/work.yml": contract(extra),
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "work", done: [] }),
  });
  repos.push(repo);
  return repo;
};

const queueAndService = (repo: Repo): void => {
  repo.write("package.json", pkg({ express: "^4.19.0", bullmq: "^5.0.0" }));
  repo.write("services/worker/package.json", pkg({ bullmq: "^5.0.0" }));
};

const weigh = (repo: Repo) => cliJson(["guardian", "weigh"], { cwd: repo.root, runtime: repoRuntime() });

describe("proportionality budget", () => {
  it("a message queue and a new service for a 50-user MVP gets the report", async () => {
    const repo = setup(context("first-customers", "stated"), "scale:\n  users: 50\n");
    queueAndService(repo);
    const run = await weigh(repo);
    assert.equal(field(run.body, "data", "proportion", "verdict"), "report");
    assert.deepEqual(field(run.body, "data", "weight", "operate"), ["queue", "service"]);
    const shown = await cli(["guardian", "weigh"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(
      shown.stdout,
      /level 2 \(proportionality\)[\s\S]*requested: [\s\S]*simplest viable: [\s\S]*do nothing now/,
    );
    assert.match(shown.stdout, /users: 50/);
  });

  it("stays silent for a team that has demonstrated the concepts", async () => {
    const repo = setup(context("first-customers", "stated", ["queue", "service"]));
    queueAndService(repo);
    const run = await weigh(repo);
    assert.equal(field(run.body, "data", "proportion", "verdict"), "silent");
    assert.equal(field(run.body, "data", "proportion", "reason"), "demonstrated");
  });

  it("inferred context never triggers a report", async () => {
    const stated = setup(context("idea", "stated"));
    stated.write("package.json", pkg({ express: "^4.19.0", zod: "^3.23.0" }));
    assert.equal(field((await weigh(stated)).body, "data", "proportion", "verdict"), "report");
    const inferred = setup(context("idea", "inferred"));
    inferred.write("package.json", pkg({ express: "^4.19.0", zod: "^3.23.0" }));
    assert.equal(field((await weigh(inferred)).body, "data", "proportion", "verdict"), "silent");
  });

  it("a contract without scale numbers asks for them instead of estimating", async () => {
    const repo = setup(context("first-customers", "stated"));
    queueAndService(repo);
    const run = await weigh(repo);
    assert.equal(field(run.body, "data", "proportion", "askScale"), true);
    assert.deepEqual(field(run.body, "data", "proportion", "problem", "scale"), []);
    assert.match(String(field(run.body, "data", "report", "nextStep")), /ask the person for the scale number/);
  });
});
