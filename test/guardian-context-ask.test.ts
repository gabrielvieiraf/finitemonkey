import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { companyContext } from "../src/guardian/context.js";
import { answersIn } from "../src/guardian/context-answer.js";
import { missingContext } from "../src/guardian/context-ask.js";
import { readGoals } from "../src/guardian/goals.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const pkg = (deps: Readonly<Record<string, string>>): string =>
  `${JSON.stringify({ name: "app", dependencies: deps }, null, 2)}\n`;

const CONTRACT =
  "id: work\ngoal: cache plans\nscope:\n  paths: [src/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n";

const setup = (files: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({
    "package.json": pkg({ express: "^4.0.0" }),
    "src/app.ts": "export const app = 1;\n",
    ".finitemonkey/tasks/work.yml": CONTRACT,
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "work", done: [] }),
    ".finitemonkey/policy.yml": policyWith({ proportionality: "active" }),
    ...files,
  });
  repos.push(repo);
  return repo;
};

const scan = (repo: Repo) => cli(["guardian", "scan", "--record"], { cwd: repo.root, runtime: repoRuntime() });

describe("proportionality asks for the missing context once", () => {
  it("does not ask what the infra inventory and the ownership file already answer", () => {
    const repo = setup({
      ".finitemonkey/infra.yml": "schema: finitemonkey/infra@1\nlevel: 2\n",
      ".finitemonkey/ownership.yml": "components:\n  - name: api\n    type: service\n    owner: ana\n",
    });
    const context = companyContext(readGoals(repoRuntime(), repo.root));
    assert.deepEqual(missingContext(repoRuntime(), repo.root, context), ["stage", "cost"]);
  });

  it("reads one answer per line in any of the three languages and ignores an invalid stage", () => {
    assert.deepEqual(answersIn("estágio: growing\ncusto: 40\nmaintains: Ana", ["stage", "cost", "maintains"]), {
      stage: "growing",
      cost: "40",
      maintains: "Ana",
    });
    assert.deepEqual(answersIn("stage: huge", ["stage"]), {});
  });

  it("an irreversible step with no context asks once, and the answer lands in goals.yml as stated", async () => {
    const repo = setup();
    repo.write("package.json", pkg({ express: "^4.0.0", ioredis: "^5.0.0" }));
    await scan(repo);
    const first = contextOf(await fireHook(repo, "UserPromptSubmit", { prompt: "go on" }));
    assert.match(first, /hard to undo and the project context is missing/);
    assert.match(first, /stage: idea, first-customers, growing or stable\?/);
    assert.match(first, /maintains: who keeps this running/);
    repo.write("package.json", pkg({ express: "^4.0.0", ioredis: "^5.0.0", bullmq: "^5.0.0" }));
    await scan(repo);
    const second = contextOf(await fireHook(repo, "UserPromptSubmit", { prompt: "and now?" }));
    assert.match(second, /queue/);
    assert.doesNotMatch(second, /project context is missing/);
    const answer = await fireHook(repo, "UserPromptSubmit", {
      prompt: "stage: growing\ncost: 40\ndeploy: manual over ssh\nmaintains: Ana",
    });
    assert.match(contextOf(answer), /saved the person's answer .* stage, cost, deploy, maintains/);
    const goals = repo.read(".finitemonkey/goals.yml");
    assert.match(goals, /stage:\n\s+value: growing\n\s+origin: stated/);
    assert.match(goals, /maintains:\n\s+value: Ana\n\s+origin: stated/);
    const context = companyContext(readGoals(repoRuntime(), repo.root));
    assert.equal(context.stage?.origin, "stated");
    assert.deepEqual(missingContext(repoRuntime(), repo.root, context), []);
  });
});
