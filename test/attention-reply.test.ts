import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { timeboxReply } from "../src/attention/reply.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const HOUR = 3_600_000;
const DAY = Date.UTC(2026, 9, 1, 9);
const START = DAY + 86_400_000;

const contract = (id: string): string =>
  `id: ${id}\ngoal: ${id}\nsize: M\nscope:\n  paths: [src/billing/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const ledgerOf = (task: string, start: number, hours: number): string => {
  const runtime = repoRuntime();
  const line = (check: string, status: string, at: number): string =>
    signedLine(runtime, {
      schema: "finitemonkey/evidence@1",
      task,
      check,
      kind: check === "*gate*" ? "gate" : "command",
      status,
      treeHash: "t",
      at: new Date(at).toISOString(),
      notes: [],
    });
  return `${[line("t", "failed", start), line("*gate*", "passed", start + hours * HOUR)].join("\n")}\n`;
};

const setup = (): Repo => {
  const past = Object.fromEntries(
    [1, 2, 3, 4, 5].flatMap((n) => [
      [`.fm/tasks/p${String(n)}.yml`, contract(`p${String(n)}`)],
      [`.fm/evidence/p${String(n)}.jsonl`, ledgerOf(`p${String(n)}`, DAY, n)],
    ]),
  );
  const repo = makeRepo({
    ...past,
    ".fm/policy.yml": policyWith({ attention: "active" }),
    ".fm/tasks/now.yml": contract("now"),
    ".fm/evidence/now.jsonl": ledgerOf("now", START, 0),
    ".fm/state.json": JSON.stringify({
      schemaVersion: 1,
      active: "now",
      done: ["p1", "p2", "p3", "p4", "p5"],
    }),
  });
  repos.push(repo);
  return repo;
};

const promptAt = (repo: Repo, hours: number, prompt: string): Promise<string> =>
  fireHook(
    repo,
    "UserPromptSubmit",
    { prompt },
    repoRuntime({ now: () => new Date(START + hours * HOUR).toISOString() }),
  ).then(contextOf);

const ASKED = /usually take/;

describe("timebox answers", () => {
  it("reads short replies in English, Portuguese and Spanish", () => {
    assert.equal(timeboxReply("Continue."), "continue");
    assert.equal(timeboxReply(" continuar!"), "continue");
    assert.equal(timeboxReply("seguir"), "continue");
    assert.equal(timeboxReply("STOP"), "stop");
    assert.equal(timeboxReply("parar"), "stop");
    assert.equal(timeboxReply("continue with the refactor of the totals module"), undefined);
    assert.equal(timeboxReply("yes"), undefined);
  });

  it("asks again at the next horizon when the question is ignored", async () => {
    const repo = setup();
    assert.match(await promptAt(repo, 6, "go on"), ASKED);
    assert.doesNotMatch(await promptAt(repo, 6.5, "fix the rounding"), ASKED);
    assert.match(await promptAt(repo, 9, "and now the tests"), ASKED);
    assert.match(repo.read(".fm/log.jsonl"), /"event":"attention.timebox","task":"now","answer":"ignored"/);
  });

  it('silences the question for the task after "continue"', async () => {
    const repo = setup();
    assert.match(await promptAt(repo, 6, "go on"), ASKED);
    assert.match(await promptAt(repo, 6.5, "continue"), /silenced for this task/);
    assert.doesNotMatch(await promptAt(repo, 9, "and now the tests"), ASKED);
    assert.doesNotMatch(await promptAt(repo, 13, "still here"), ASKED);
    assert.match(repo.read(".fm/log.jsonl"), /"answer":"continue"/);
  });

  it('parks the task after "stop" and does not ask again', async () => {
    const repo = setup();
    assert.match(await promptAt(repo, 6, "go on"), ASKED);
    assert.match(await promptAt(repo, 6.5, "parar"), /parked as p1.*finitemonkey unpark p1/);
    assert.match(repo.read(".fm/parking.jsonl"), /"task":"now"/);
    assert.doesNotMatch(await promptAt(repo, 9, "hello"), ASKED);
  });
});
