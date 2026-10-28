import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { completionClaim } from "../src/claims/detect.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const SOURCE = join(PROJECT, "src", "checkout.ts");
const TEST = join(PROJECT, "test", "checkout.test.ts");
const STATUS = toAbsolutePath(join(PROJECT, ".finitemonkey", "cache", "gate-status.json"));
const ACTIVE = "guards:\n  claims: active\n";

const projectFs = (policy: string = ACTIVE): MemoryFs =>
  memoryFs({
    [toAbsolutePath(join(PROJECT, ".git", "HEAD"))]: "ref: refs/heads/main\n",
    [toAbsolutePath(join(PROJECT, ".finitemonkey", "config.yml"))]: "lang: en\n",
    [toAbsolutePath(join(PROJECT, ".finitemonkey", "policy.yml"))]: policy,
  });

const fire = async (fs: MemoryFs, event: HookEvent, payload: JsonObject): Promise<HookOutcome> => {
  const runtime = fakeRuntime({ fs });
  fs.tick(1000);
  return runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: PROJECT, ...payload })),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: PROJECT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const editFile = (fs: MemoryFs, file: string): Promise<HookOutcome> =>
  fire(fs, "PostToolUse", {
    tool_name: "Edit",
    tool_input: { file_path: file, old_string: "a", new_string: "b" },
    tool_response: { success: true },
  });

const gateStatus = (fs: MemoryFs, status: string, detail = ""): void => {
  fs.writeText(STATUS, JSON.stringify({ status, task: "pix", detail, at: fs.now() }));
};

const stop = (fs: MemoryFs, message: string): Promise<HookOutcome> =>
  fire(fs, "Stop", { stop_hook_active: false, last_assistant_message: message });

const blockReason = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const body = parseBody(outcome.stdout);
  const reason = field(body, "reason");
  return field(body, "decision") === "block" && typeof reason === "string" ? reason : "";
};

describe("claims: what counts as a completion claim", () => {
  it("finds claims in English, Portuguese and Spanish", () => {
    assert.equal(completionClaim("Done: checkout works and tests pass."), "Done: checkout works and tests pass.");
    assert.ok(completionClaim("Implemented the Pix flow.\nAll tests pass.") !== undefined);
    assert.ok(completionClaim("Pronto, o checkout está funcionando.") !== undefined);
    assert.ok(completionClaim("Listo: las pruebas pasan.") !== undefined);
  });

  it("ignores negations, questions and messages that report failures", () => {
    assert.equal(completionClaim("This is not done yet."), undefined);
    assert.equal(completionClaim("It isn't finished."), undefined);
    assert.equal(completionClaim("Ainda não está pronto."), undefined);
    assert.equal(completionClaim("Should I mark it done?"), undefined);
    assert.equal(completionClaim("I fixed the import but the tests still fail."), undefined);
    assert.equal(completionClaim("Todavía no está listo."), undefined);
    assert.equal(completionClaim("Reading the checkout module now."), undefined);
  });
});

describe("claims: Stop blocks done claims the gate did not confirm", () => {
  it("blocks a completion claim when the last gate run failed, quoting the claim and the failing check", async () => {
    const fs = projectFs();
    await editFile(fs, SOURCE);
    gateStatus(fs, "failed", "tests (exit 1)");
    const reason = blockReason(await stop(fs, "Done: checkout works and tests pass."));
    assert.match(reason, /Done: checkout works and tests pass\./);
    assert.match(reason, /the last gate run failed \(tests \(exit 1\)\)/);
  });

  it("allows the claim when the gate passed after the last edit", async () => {
    const fs = projectFs();
    await editFile(fs, SOURCE);
    fs.tick(1000);
    gateStatus(fs, "passed");
    assert.equal(blockReason(await stop(fs, "Done: checkout works.")), "");
  });

  it("treats a passing run older than the last edit as stale", async () => {
    const fs = projectFs();
    gateStatus(fs, "passed");
    await editFile(fs, SOURCE);
    assert.match(blockReason(await stop(fs, "All tests pass.")), /older than the last edit/);
  });

  it("blocks once per gate run, then lets the rewritten message through", async () => {
    const fs = projectFs();
    await editFile(fs, SOURCE);
    gateStatus(fs, "failed", "tests");
    assert.notEqual(blockReason(await stop(fs, "Done.")), "");
    assert.equal(blockReason(await stop(fs, "Done.")), "");
  });

  it("does nothing without a claim, without edits, or with the guard off", async () => {
    const quiet = projectFs();
    await editFile(quiet, SOURCE);
    gateStatus(quiet, "failed", "tests");
    assert.equal(blockReason(await stop(quiet, "The tests still fail on the total; next I look at rounding.")), "");
    const noEdits = projectFs();
    gateStatus(noEdits, "failed", "tests");
    assert.equal(blockReason(await stop(noEdits, "Done.")), "");
    const off = projectFs("guards:\n  claims: off\n");
    await editFile(off, SOURCE);
    gateStatus(off, "failed", "tests");
    assert.equal(blockReason(await stop(off, "Done.")), "");
  });

  it("shadow mode records the claim without blocking", async () => {
    const fs = projectFs("guards:\n  claims: shadow\n");
    await editFile(fs, SOURCE);
    gateStatus(fs, "failed", "tests");
    assert.equal(blockReason(await stop(fs, "Done.")), "");
    const log = fs.readText(toAbsolutePath(join(PROJECT, ".finitemonkey", "log.jsonl")));
    assert.ok(log.ok && log.value.includes('"claims.unconfirmed"') && log.value.includes('"guard_shadow"'));
  });
});

describe("claims: test and contract edits need the person's yes", () => {
  it("lists a test edited in the same session as the claim and releases with finitemonkey: allow claims", async () => {
    const fs = projectFs();
    await editFile(fs, SOURCE);
    await editFile(fs, TEST);
    fs.tick(1000);
    gateStatus(fs, "passed");
    const reason = blockReason(await stop(fs, "Done: checkout works."));
    assert.match(reason, /test\/checkout\.test\.ts/);
    assert.match(reason, /ask the person to approve them/);
    await fire(fs, "UserPromptSubmit", { prompt: "finitemonkey: allow claims the old total was wrong" });
    await editFile(fs, SOURCE);
    fs.tick(1000);
    gateStatus(fs, "passed");
    assert.equal(blockReason(await stop(fs, "Done: checkout works.")), "");
  });

  it("lists an edited task contract", async () => {
    const fs = projectFs();
    await editFile(fs, join(PROJECT, ".finitemonkey", "tasks", "pix.yml"));
    fs.tick(1000);
    gateStatus(fs, "passed");
    assert.match(blockReason(await stop(fs, "Finished.")), /\.finitemonkey\/tasks\/pix\.yml/);
  });
});
