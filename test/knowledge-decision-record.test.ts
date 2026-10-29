import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { assembleRecord } from "../src/knowledge/decision-record.js";
import { fmPaths } from "../src/task/paths.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { cli, cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const CONTRACT = (id: string): string =>
  [
    `id: ${id}`,
    "goal: take payments",
    "acceptance:",
    "  - id: C1",
    "    check: command",
    "    run: node --version",
    "",
  ].join("\n");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (id: string): TempRepo => {
  const repo = tempRepo({
    "package.json": `${JSON.stringify({ name: "shop", dependencies: { express: "4.0.0" } }, null, 2)}\n`,
    "src/app/index.ts": "export const app = 1;\n",
  });
  repos.push(repo);
  trustContract(repo.root, id, CONTRACT(id));
  return repo;
};

const watched = (): { readonly runtime: Runtime; readonly commands: string[] } => {
  const base = nodeRuntime();
  const commands: string[] = [];
  return {
    commands,
    runtime: {
      ...base,
      exec: (request: ExecRequest) => {
        commands.push(request.command);
        return base.exec(request);
      },
    },
  };
};

describe("decision records", () => {
  it("assembles the record without a model when a task closes with a vendor dependency, and shows no reason", async () => {
    const repo = project("pay");
    write(
      repo.root,
      "package.json",
      `${JSON.stringify({ name: "shop", dependencies: { express: "4.0.0", stripe: "14.0.0" } }, null, 2)}\n`,
    );
    const { runtime, commands } = watched();
    const done = await cliJson(["task", "done", "pay"], { cwd: repo.root, runtime });
    assert.equal(done.code, 0, done.stdout);
    assert.ok(!commands.some((command) => /claude|anthropic|openai/i.test(command)), commands.join(","));
    const records = await cliJson(["decide", "records"], { cwd: repo.root, runtime: nodeRuntime() });
    const list = field(records.body, "data", "records");
    assert.ok(Array.isArray(list) && list.length === 1, JSON.stringify(list));
    assert.deepEqual(field(list[0], "changes"), [{ class: "vendor", detail: "+stripe" }]);
    assert.equal(field(list[0], "reason"), null);
    const human = await cli(["decide", "records"], { cwd: repo.root, runtime: nodeRuntime() });
    assert.match(human.stdout, /why: no reason/);
  });

  it("only the person's sentence becomes the reason", async () => {
    const repo = project("pay2");
    write(repo.root, "src/reports/summary.ts", "export const summary = 1;\n");
    const closed = await cliJson(["task", "done", "pay2"], { cwd: repo.root, runtime: nodeRuntime() });
    assert.equal(closed.code, 0, closed.stdout);
    const agent = await cliJson(["decide", "why", "pay2", "simpler than a queue"], {
      cwd: repo.root,
      runtime: nodeRuntime(),
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(agent.code, 0);
    const person = await cliJson(["decide", "why", "pay2", "simpler than a queue"], {
      cwd: repo.root,
      runtime: nodeRuntime(),
      stdin: tty(),
    });
    assert.equal(person.code, 0, person.stdout);
    const records = await cliJson(["decide", "records", "pay2"], { cwd: repo.root, runtime: nodeRuntime() });
    assert.match(records.stdout, /simpler than a queue/);
    assert.match(records.stdout, /"class":"architecture","detail":"src\/reports\/"/);
  });

  it("only dependency, vendor and architecture changes trigger a record", () => {
    const repo = project("copy");
    write(repo.root, "src/app/index.ts", "export const app = 2;\n");
    assert.equal(assembleRecord(nodeRuntime(), fmPaths(repo.root), "copy"), undefined);
  });
});
