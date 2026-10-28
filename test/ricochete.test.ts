import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { GUARD_SETS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { withPolicy } from "../src/policy/guards.js";
import { criterionIds, isHorizonHelp } from "../src/ricochete/markers.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, parseBody, ROOT, stdinFrom } from "./support.js";

const found = GUARD_SETS.find((set) => set.id === "ricochete");
if (found === undefined) throw new Error("ricochete guard set missing");
const RICOCHETE = found;

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const judgmentIndex = (session: string, frontier: string): string =>
  `${JSON.stringify({
    schemaVersion: 1,
    session,
    index: { firing: true, frontier, fastAccepts: frontier === "judgment" ? 1 : 0, caughtAfterApproval: 0 },
  })}\n`;

const project = async (frontier: "judgment" | "exploration" | "none"): Promise<Repo> => {
  const repo = makeRepo({ "src/refund.ts": "export const refund = () => 0;\n" });
  repos.push(repo);
  await cliJson(
    [
      "task",
      "new",
      "t1",
      "--goal",
      "refunds",
      "--run",
      "node --test",
      "--manual",
      "a refund with an invalid card is rejected",
    ],
    { cwd: repo.root, runtime: repoRuntime() },
  );
  if (frontier !== "none") repo.write(".finitemonkey/signals-index.json", judgmentIndex("s1", frontier));
  return repo;
};

const stop = (repo: Repo, message: string): Promise<HookOutcome> => {
  const runtime = repoRuntime();
  return runHook("Stop", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: "s1",
        cwd: repo.root,
        stop_hook_active: false,
        last_assistant_message: message,
      }),
    ),
    deadlineMs: 60_000,
    handlers: withPolicy(RICOCHETE),
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const reasonOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const body = parseBody(outcome.stdout);
  return field(body, "decision") === "block" ? String(field(body, "reason")) : "";
};

const HORIZON = [
  "Questions an expert would ask:",
  "1. Should a refund go back to the same card? It decides which provider call you need.",
  "Rewritten request: you asked for a refund button; proposal: refund to the original card, with a reason.",
].join("\n");

describe("ricochete: Stop holds a horizon help without a judgment criterion", () => {
  it("blocks when a judgment signal exists and no contract check is named", async () => {
    const repo = await project("judgment");
    const reason = reasonOf(await stop(repo, HORIZON));
    assert.match(reason, /widens the horizon/);
    assert.match(reason, /checks in the contract: C1, tests/);
  });

  it("blocks when the named criterion is not in the contract", async () => {
    const repo = await project("judgment");
    assert.notEqual(reasonOf(await stop(repo, `${HORIZON}\nJudgment criterion: T9`)), "");
  });

  it("lets it through when the criterion names a contract check", async () => {
    const repo = await project("judgment");
    const manual = `${HORIZON}\nJudgment criterion: M1 (a refund with an invalid card is rejected)`;
    assert.equal(reasonOf(await stop(repo, manual)), "");
    assert.equal(reasonOf(await stop(repo, `${HORIZON}\nCritério de julgamento: C1`)), "");
  });

  it("does not fire without a judgment signal or without horizon help", async () => {
    assert.equal(reasonOf(await stop(await project("exploration"), HORIZON)), "");
    assert.equal(reasonOf(await stop(await project("none"), HORIZON)), "");
    assert.equal(reasonOf(await stop(await project("judgment"), "Fixed the refund rounding.")), "");
  });

  it("recognizes the headings and criterion lines in three languages", () => {
    assert.ok(isHorizonHelp("Perguntas que um especialista faria"));
    assert.ok(isHorizonHelp("Preguntas que haría un experto"));
    assert.deepEqual(criterionIds("Criterio de juicio: `C2`\nJudgment criterion: M1"), ["C2", "M1"]);
  });
});

describe("ricochete: closing a task with judgment signals", () => {
  const closing = async (frontier: "judgment" | "exploration"): Promise<Repo> => {
    const repo = await project(frontier);
    repo.write(
      ".finitemonkey/cache/gate-status.json",
      `${JSON.stringify({ schemaVersion: 1, status: "passed", task: "t1", detail: "", at: new Date().toISOString() })}\n`,
    );
    return repo;
  };

  it("lists the perturbation questions and which the contract covers, once", async () => {
    const repo = await closing("judgment");
    const reason = reasonOf(await stop(repo, "Done: refunds work and the gate is green."));
    assert.match(reason, /Task t1 is closing with judgment signals/);
    assert.match(reason, /What if the input is invalid\? Covered by: M1\./);
    assert.match(reason, /What if the requirement changes\? No contract check covers it\./);
    assert.match(reason, /What if it runs twice or at the same time\? No contract check covers it\./);
    assert.equal(reasonOf(await stop(repo, "Done: refunds work and the gate is green.")), "");
  });

  it("does nothing when the session has no judgment signal or the report already has them", async () => {
    assert.equal(reasonOf(await stop(await closing("exploration"), "Done.")), "");
    assert.equal(reasonOf(await stop(await closing("judgment"), "Perturbation questions: ...")), "");
  });
});

describe("ricochete: the skill body stays under the size budget", () => {
  it("SKILL.md is under skillBodyBytesMax and names the protocols", () => {
    const budgets: unknown = JSON.parse(readFileSync(join(ROOT, "budgets.json"), "utf8"));
    const max = field(budgets, "context", "skillBodyBytesMax");
    const text = readFileSync(join(ROOT, "plugin", "skills", "ricochete", "SKILL.md"), "utf8");
    assert.equal(typeof max, "number");
    assert.ok(Buffer.byteLength(text) < Number(max), `${String(Buffer.byteLength(text))} bytes`);
    assert.ok(Buffer.byteLength(text) < 4096);
    assert.match(text, /^name: ricochete$/m);
    for (const heading of ["## Exploration", "## Judgment", "## Mode, per domain", "Perturbation questions"]) {
      assert.ok(text.includes(heading), heading);
    }
  });
});
