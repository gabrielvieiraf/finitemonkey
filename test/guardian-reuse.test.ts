import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { findExisting } from "../src/guardian/existing.js";
import { importedPackages, stemOf } from "../src/guardian/roles.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook, policyWith, silent } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const pkg = (deps: Readonly<Record<string, string>>): string =>
  `${JSON.stringify({ name: "app", dependencies: deps }, null, 2)}\n`;

const CONTRACT =
  "id: work\ngoal: fetch plans\nscope:\n  paths: [src/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n";

const base = (): Repo => {
  const repo = makeRepo({
    "package.json": pkg({ axios: "^1.7.0" }),
    "src/api/client.ts": 'import axios from "axios";\nexport const api = axios.create();\n',
    "src/billing/plans.ts": "export const plans = [];\n",
  });
  repos.push(repo);
  return repo;
};

describe("find what the project already has", () => {
  it("reads imports and strips role words from file names", () => {
    assert.deepEqual(
      importedPackages('import got from "got";\nconst x = require("@scope/pkg/sub");\nimport "./local";'),
      ["got", "@scope/pkg"],
    );
    assert.equal(stemOf("src/lib/http-client.ts"), stemOf("src/net/httpService.ts"));
  });

  it("reports a second HTTP client next to the existing one, with the existing path", async () => {
    const repo = base();
    repo.write("package.json", pkg({ axios: "^1.7.0", got: "^14.0.0" }));
    repo.write("src/lib/fetcher.ts", 'import got from "got";\nexport const fetcher = got.extend({});\n');
    const matches = findExisting(repoRuntime(), fmPaths(repo.root));
    assert.deepEqual(
      matches.map((item) => [item.kind, item.added, item.existing, item.role]),
      [
        ["dependency", "got", "axios", "http client"],
        ["import", "src/lib/fetcher.ts (got)", "src/api/client.ts", "http client"],
      ],
    );
    const run = await cliJson(["guardian", "reuse"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(run.body, "data", "schema"), "finitemonkey/guardian-reuse@1");
    const shown = await cli(["guardian", "reuse"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(shown.stdout, /level 2 \(reuse\)[\s\S]*src\/api\/client\.ts/);
  });

  it("a module with no counterpart runs without a message", async () => {
    const repo = base();
    repo.write("src/billing/invoice.ts", 'import { plans } from "./plans";\nexport const invoice = plans;\n');
    assert.deepEqual(findExisting(repoRuntime(), fmPaths(repo.root)), []);
    const shown = await cli(["guardian", "reuse"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(shown.code, 0);
    assert.equal(shown.stdout.trim(), "");
  });

  it("runs outside the synchronous hooks: Stop only spawns the scan, the next prompt shows the result", async () => {
    const repo = base();
    repo.write(".finitemonkey/tasks/work.yml", CONTRACT);
    repo.write(".finitemonkey/state.json", JSON.stringify({ schemaVersion: 1, active: "work", done: [] }));
    repo.write(".finitemonkey/policy.yml", policyWith({ "guardian-reuse": "active" }));
    const spawned: string[][] = [];
    const stop = await fireHook(repo, "Stop", {}, repoRuntime({ spawned }));
    assert.equal(silent(stop), true);
    assert.deepEqual(
      spawned.filter((args) => args[0] === "guardian").map((args) => args.slice(0, 3)),
      [["guardian", "scan", "--record"]],
    );
    repo.write("package.json", pkg({ axios: "^1.7.0", got: "^14.0.0" }));
    await cli(["guardian", "scan", "--record"], { cwd: repo.root, runtime: repoRuntime() });
    const shown = await fireHook(repo, "UserPromptSubmit", { prompt: "next" });
    assert.match(contextOf(shown), /level 2 \(reuse\)[\s\S]*axios/);
    assert.equal(contextOf(await fireHook(repo, "UserPromptSubmit", { prompt: "again" })), "");
  });
});
