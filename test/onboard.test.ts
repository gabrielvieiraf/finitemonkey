import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { Runtime } from "../src/core/runtime.js";
import { fitBlock, fits, OVERVIEW_HEADING } from "../src/onboard/block.js";
import { implicitContract } from "../src/task/implicit.js";
import { git, type TempRepo, tempRepo } from "./git-support.js";
import { cliJson, field } from "./support.js";

const blockOf = (text: string): readonly string[] => {
  const lines = text.split("\n");
  const start = lines.indexOf("<!-- finitemonkey:onboard:begin -->");
  const end = lines.indexOf("<!-- finitemonkey:onboard:end -->");
  return lines.slice(start + 1, end);
};

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

  it("never writes the block past the configured lines and tokens", async () => {
    const repo = project();
    const policy = "knowledge:\n  blockMaxLines: 5\n  blockMaxTokens: 400\n";
    const dir = join(repo.root, ".finitemonkey");
    await cliJson(["onboard"], { cwd: repo.root, runtime: nodeRuntime() });
    writeFileSync(join(dir, "policy.yml"), policy);
    const run = await cliJson(["onboard"], { cwd: repo.root, runtime: nodeRuntime() });
    const block = blockOf(readFileSync(join(repo.root, "AGENTS.md"), "utf8"));
    assert.ok(block.length <= 5, block.join("\n"));
    assert.equal(field(run.body, "data", "block", "maxLines"), 5);
    assert.ok(Number(field(run.body, "data", "block", "dropped")) > 0);
    for (let max = 1; max < 40; max += 1) {
      const rows = Array.from({ length: 30 }, (_, index) => `| test | \`npm run t${String(index)}\` |`);
      const fitted = fitBlock([{ heading: "## Commands", intro: ["| a | b |"], rows }], {
        maxLines: max,
        maxTokens: 120,
      });
      assert.ok(fits(fitted.lines, { maxLines: max, maxTokens: 120 }));
    }
  });

  it("drops a command that stopped working on the next onboard and shows the change", async () => {
    const repo = project();
    await cliJson(["onboard"], { cwd: repo.root, runtime: nodeRuntime() });
    assert.match(readFileSync(join(repo.root, "AGENTS.md"), "utf8"), /\| build \| `npm run build` \|/);
    const broken = JSON.parse(PACKAGE) as { scripts: Record<string, string> };
    broken.scripts["build"] = 'node -e "process.exit(1)"';
    writeFileSync(join(repo.root, "package.json"), `${JSON.stringify(broken)}\n`);
    const run = await cliJson(["onboard"], { cwd: repo.root, runtime: nodeRuntime() });
    assert.ok(!readFileSync(join(repo.root, "AGENTS.md"), "utf8").includes("npm run build"));
    assert.deepEqual(field(run.body, "data", "block", "removed"), ["| build | `npm run build` |"]);
  });

  it("never writes an overview or summary section", async () => {
    const repo = project();
    writeFileSync(
      join(repo.root, "AGENTS.md"),
      "# Team rules\n\n## Overview\n\nThis repo does things. Run `npm run test`.\n",
    );
    await cliJson(["onboard"], { cwd: repo.root, runtime: nodeRuntime() });
    assert.ok(!blockOf(readFileSync(join(repo.root, "AGENTS.md"), "utf8")).some((line) => OVERVIEW_HEADING.test(line)));
    const fitted = fitBlock(
      [
        { heading: "## Repository overview", intro: ["It is an app."], rows: ["- x"] },
        { heading: "## Commands that ran", intro: [], rows: ["- `npm test`", "## Summary"] },
      ],
      { maxLines: 50, maxTokens: 500 },
    );
    assert.deepEqual(fitted.lines, ["## Commands that ran", "", "- `npm test`"]);
  });
});
