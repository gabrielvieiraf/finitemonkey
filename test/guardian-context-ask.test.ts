import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { companyContext } from "../src/guardian/context.js";
import { answersIn } from "../src/guardian/context-answer.js";
import { missingContext, withDerivedCost } from "../src/guardian/context-ask.js";
import { readGoals } from "../src/guardian/goals.js";
import { scanChange } from "../src/guardian/scan.js";
import { createTranslator } from "../src/i18n/translate.js";
import { fmPaths } from "../src/task/paths.js";
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
    ".fm/tasks/work.yml": CONTRACT,
    ".fm/state.json": JSON.stringify({ schemaVersion: 1, active: "work", done: [] }),
    ".fm/policy.yml": policyWith({ proportionality: "active" }),
    ...files,
  });
  repos.push(repo);
  return repo;
};

const scan = (repo: Repo) => cli(["guardian", "scan", "--record"], { cwd: repo.root, runtime: repoRuntime() });

describe("proportionality asks for the missing context once", () => {
  it("does not ask what the infra inventory and the ownership file already answer", () => {
    const repo = setup({
      ".fm/infra.yml": "schema: finitemonkey/infra@1\nlevel: 2\n",
      ".fm/ownership.yml": "components:\n  - name: api\n    type: service\n    owner: ana\n",
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
    const goals = repo.read(".fm/goals.yml");
    assert.match(goals, /stage:\n\s+value: growing\n\s+origin: stated/);
    assert.match(goals, /maintains:\n\s+value: Ana\n\s+origin: stated/);
    const context = companyContext(readGoals(repoRuntime(), repo.root));
    assert.equal(context.stage?.origin, "stated");
    assert.deepEqual(missingContext(repoRuntime(), repo.root, context), []);
  });
  it("derives the monthly cost per FACT from the cost model instead of asking for it", () => {
    const repo = setup({
      "docs/plan/01-cost-monthly.csv":
        "fact,unit,base,conservative,readable\nprice_per_call_usd,USD per month,60,375,a * b\nplatform_fixed_brl,USD per month,55.5555,55.5555,c / d\n",
    });
    repo.write("package.json", pkg({ express: "^4.0.0", ioredis: "^5.0.0" }));
    const context = companyContext(readGoals(repoRuntime(), repo.root));
    assert.deepEqual(missingContext(repoRuntime(), repo.root, context), ["stage", "deploy", "maintains"]);
    const scan = scanChange(repoRuntime(), createTranslator("en"), fmPaths(repo.root), "HEAD");
    assert.deepEqual(scan.proportion.askContext, ["stage", "deploy", "maintains"]);
    const report = scan.reports.find((item) => item.feature === "proportionality")?.report;
    assert.ok(
      report?.evidence.includes(
        "context.cost docs/plan/01-cost-monthly.csv: price_per_call_usd 60 / 375 USD, platform_fixed_brl 55.56 / 55.56 USD (inferred)",
      ),
    );
  });

  it("keeps the stated cost over the cost model", () => {
    const repo = setup({
      ".fm/goals.yml": 'context:\n  cost:\n    value: "40"\n    origin: stated\n',
      "docs/plan/01-cost-monthly.csv":
        "fact,unit,base,conservative,readable\nprice_per_call_usd,USD per month,60,375,a\n",
    });
    const context = withDerivedCost(repoRuntime(), repo.root, companyContext(readGoals(repoRuntime(), repo.root)));
    assert.deepEqual(context.cost, { value: "40", origin: "stated" });
  });
});
