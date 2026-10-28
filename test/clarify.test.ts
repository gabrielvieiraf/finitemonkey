import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { requestSize } from "../src/clarify/size.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { parseContract } from "../src/task/load.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const ACTIVE = "guards:\n  clarify: active\n";
const VAGUE = "Build a delivery app";

const projectFs = (policy: string = ACTIVE, extra: Readonly<Record<string, string>> = {}): MemoryFs =>
  memoryFs({
    [toAbsolutePath(join(PROJECT, ".git", "HEAD"))]: "ref: refs/heads/main\n",
    [toAbsolutePath(join(PROJECT, ".finitemonkey", "config.yml"))]: "lang: en\n",
    [toAbsolutePath(join(PROJECT, ".finitemonkey", "policy.yml"))]: policy,
    ...extra,
  });

const prompt = async (fs: MemoryFs, text: string, session = "s1"): Promise<HookOutcome> => {
  const runtime = fakeRuntime({ fs });
  fs.tick(1000);
  const payload: JsonObject = { hook_event_name: "UserPromptSubmit", session_id: session, cwd: PROJECT, prompt: text };
  return runHook("UserPromptSubmit", {
    stdin: stdinFrom(JSON.stringify(payload)),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: PROJECT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const context = (outcome: HookOutcome): string => {
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

describe("clarify: request size", () => {
  it("sizes vague product requests as L, multi-part features as M and small fixes as S", () => {
    assert.equal(requestSize(VAGUE, { blueprint: false }), "L");
    assert.equal(requestSize("Crie um aplicativo de entregas", { blueprint: false }), "L");
    assert.equal(
      requestSize("Add Pix checkout, a confirmation screen and an email receipt", { blueprint: false }),
      "M",
    );
    assert.equal(requestSize("Fix the typo in the README header", { blueprint: false }), "S");
    assert.equal(requestSize("Why does the checkout total round down?", { blueprint: false }), "S");
    assert.equal(requestSize("Add the plans page to the pricing area", { blueprint: false }), "S");
    assert.equal(requestSize("Add the plans page to the pricing area", { blueprint: true }), "M");
    assert.equal(requestSize("/review", { blueprint: false }), "S");
  });
});

describe("clarify: one round of questions before work without a contract", () => {
  it("asks for goal, scope, what exists and how to verify, with at most three questions, once", async () => {
    const fs = projectFs();
    const first = context(await prompt(fs, VAGUE));
    assert.match(first, /goal in one line, the scope, what exists today, and how we verify it is done/);
    assert.match(first, /at most 3 multiple-choice questions/);
    assert.match(first, /in this one round only/);
    assert.match(first, /state your assumptions in one line/);
    assert.match(first, /--answer/);
    assert.equal(context(await prompt(fs, "Build a marketplace for restaurants as well")), "");
    assert.notEqual(context(await prompt(fs, VAGUE, "s2")), "");
  });

  it("small requests and tasks with a contract get no extra context", async () => {
    assert.equal(context(await prompt(projectFs(), "Fix the typo in the README header")), "");
    const contracted = projectFs(ACTIVE, {
      [toAbsolutePath(join(PROJECT, ".finitemonkey", "state.json"))]: JSON.stringify({ active: "pix" }),
    });
    assert.equal(context(await prompt(contracted, VAGUE)), "");
  });

  it("shadow records what it would ask and adds nothing; off does nothing", async () => {
    const shadow = projectFs("guards:\n  clarify: shadow\n");
    assert.equal(context(await prompt(shadow, VAGUE)), "");
    const log = shadow.readText(toAbsolutePath(join(PROJECT, ".finitemonkey", "log.jsonl")));
    assert.ok(log.ok && log.value.includes('"feature_shadow"') && log.value.includes('"clarify.asked"'));
    const off = projectFs("guards:\n  clarify: off\n");
    assert.equal(context(await prompt(off, VAGUE)), "");
  });
});

describe("clarify: the confirmed answers become the contract", () => {
  const repos: Repo[] = [];
  after(() => {
    for (const repo of repos) repo.cleanup();
  });

  it("task new --answer writes each answer to the contract", async () => {
    const repo = makeRepo({ "README.md": "# app\n" });
    repos.push(repo);
    const answers = ["Who orders: restaurant customers only", "Payment: Pix at checkout (recommended)"];
    const created = await cliJson(
      [
        "task",
        "new",
        "delivery",
        "--goal",
        "Order food for delivery",
        "--size",
        "L",
        "--answer",
        answers[0] ?? "",
        "--answer",
        answers[1] ?? "",
      ],
      { cwd: repo.root, runtime: repoRuntime() },
    );
    assert.equal(created.code, 0);
    assert.deepEqual(field(created.body, "data", "contract", "clarified"), answers);
    const parsed = parseContract("delivery", repo.read(".finitemonkey/tasks/delivery.yml"));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.clarified, answers);
  });
});
