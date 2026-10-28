import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { Runtime } from "../src/core/runtime.js";
import { implicitContract } from "../src/task/implicit.js";
import { git, type TempRepo, tempRepo } from "./git-support.js";
import { cliJson, field } from "./support.js";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const PACKAGE = JSON.stringify({
  scripts: {
    test: 'node -e "process.exit(0)"',
    lint: 'node -e "process.exit(3)"',
    build: 'node -e "process.exit(0)"',
    deploy: 'node -e "process.exit(0)"',
  },
});

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (): TempRepo => {
  const repo = tempRepo({
    "package.json": `${PACKAGE}\n`,
    "package-lock.json": "{}\n",
    "AGENTS.md": "# Team rules\n\nRun `npm run deploy` only from CI.\n",
    ".env": "API_TOKEN=placeholder\n",
  });
  git(repo.root, "rm", "-q", "--cached", ".env");
  git(repo.root, "commit", "-qm", "untrack env");
  repos.push(repo);
  return repo;
};

const counting = (): { readonly runtime: Runtime; readonly historyScans: () => number } => {
  const base = nodeRuntime();
  let scans = 0;
  return {
    runtime: {
      ...base,
      gitLines: (args, cwd, onLine) => {
        if (args[0] === "log" && args.includes("-p")) scans += 1;
        return base.gitLines(args, cwd, onLine);
      },
    },
    historyScans: () => scans,
  };
};

describe("onboard", () => {
  it("writes only the commands that ran to AGENTS.md and lists risks without fixing them", async () => {
    const repo = project();
    const { runtime } = counting();
    const run = await cliJson(["onboard"], { cwd: repo.root, runtime });
    assert.equal(run.code, 0, run.stdout);
    const agents = readFileSync(join(repo.root, "AGENTS.md"), "utf8");
    assert.ok(agents.startsWith("# Team rules\n\nRun `npm run deploy` only from CI.\n"));
    assert.match(agents, /\| test \| `npm run test` \|/);
    assert.match(agents, /\| build \| `npm run build` \|/);
    assert.ok(!agents.includes("npm run lint"));
    assert.ok(!agents.includes("| `npm run deploy`"));
    const commands = field(run.body, "data", "commands");
    assert.ok(Array.isArray(commands));
    const outcomes = Object.fromEntries(commands.map((item) => [String(field(item, "run")), field(item, "outcome")]));
    assert.equal(outcomes["npm run lint"], "failed");
    assert.equal(outcomes["npm run deploy"], "skipped");
    const risks = JSON.stringify(field(run.body, "data", "risks"));
    assert.match(risks, /"kind":"failing_command","subject":"npm run lint"/);
    assert.match(risks, /"kind":"env_in_history","subject":".env"/);
    assert.ok(existsSync(join(repo.root, ".env")));
  });

  it("is idempotent and scans the history only once", async () => {
    const repo = project();
    const { runtime, historyScans } = counting();
    await cliJson(["onboard"], { cwd: repo.root, runtime });
    const agents = readFileSync(join(repo.root, "AGENTS.md"), "utf8");
    const state = readFileSync(join(repo.root, ".finitemonkey/onboard.json"), "utf8");
    await cliJson(["onboard"], { cwd: repo.root, runtime });
    assert.equal(readFileSync(join(repo.root, "AGENTS.md"), "utf8"), agents);
    assert.equal(readFileSync(join(repo.root, ".finitemonkey/onboard.json"), "utf8"), state);
    assert.equal(historyScans(), 1);
  });

  it("feeds the implicit contract and only the person's run trusts it", async () => {
    const repo = project();
    await cliJson(["onboard"], { cwd: repo.root, runtime: nodeRuntime(), env: { CLAUDECODE: "1" }, stdin: tty() });
    assert.ok(!existsSync(join(repo.root, ".finitemonkey/trust.json")));
    await cliJson(["onboard"], { cwd: repo.root, runtime: nodeRuntime(), stdin: tty() });
    assert.match(readFileSync(join(repo.root, ".finitemonkey/trust.json"), "utf8"), /"implicit"/);
    const state = readFileSync(join(repo.root, ".finitemonkey/onboard.json"), "utf8");
    const contract = implicitContract({
      read: (path) => (path === ".finitemonkey/onboard.json" ? state : undefined),
      exists: () => false,
    });
    assert.deepEqual(
      contract.acceptance.flatMap((check) => (check.run === undefined ? [] : [check.run])),
      ["npm run build", "npm run test"],
    );
  });
});
