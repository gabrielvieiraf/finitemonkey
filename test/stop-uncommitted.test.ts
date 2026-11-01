import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runGate } from "../src/gate/run.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, NO_PR, type Repo, repoRuntime } from "./repo.js";
import { field, parseBody, stdinFrom } from "./support.js";

const t = createTranslator("en");
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const CLAIM = [
  'Checkout now retries the payment by itself when the provider times out, and customers only see "payment failed" if it keeps timing out. All 4 tests pass, including the original one. They run against the provider\'s built-in test mode, not the live service.',
  "",
  "- **How it retries:** `payOrder` in `src/checkout.js` makes up to 3 attempts, waiting a little longer between each (0.2s, then 0.4s). It only retries timeouts. Other failures, such as a declined card, still fail straight away.",
  "- **No double charges:** a timeout doesn't mean the card wasn't charged, because the provider can charge the card and then fail to answer. Each order therefore sends the same identifying key on every attempt, and the provider returns the charge it already made instead of charging again.",
  "",
  "I haven't tried this against the live provider. It's worth one real test payment before you rely on it.",
].join("\n");

const PAYFLOW = `const charges = [];
exports.charges = charges;
exports.createCharge = async ({ amount, orderId }) => {
  charges.push({ amount, orderId });
  return { id: \`ch_\${String(charges.length)}\` };
};
exports.reset = () => {
  charges.length = 0;
};
`;

const CHECKOUT = `const { createCharge } = require("../vendor/payflow/index.js");

exports.payOrder = async (order) => {
  const charge = await createCharge({ amount: order.totalCents, orderId: order.id });
  return { paid: true, chargeId: charge.id };
};
`;

const RETRYING = `const { createCharge } = require("../vendor/payflow/index.js");

const ATTEMPTS = 3;

const attempt = async (order, left) => {
  try {
    return await createCharge({ amount: order.totalCents, orderId: order.id });
  } catch (error) {
    if (error.name !== "TimeoutError" || left <= 1) throw error;
    return attempt(order, left - 1);
  }
};

exports.payOrder = async (order) => {
  const charge = await attempt(order, ATTEMPTS);
  return { paid: true, chargeId: charge.id };
};
`;

const ORIGINAL_TEST = `const { test } = require("node:test");
const assert = require("node:assert");
const { charges, reset } = require("../vendor/payflow/index.js");
const { payOrder } = require("../src/checkout.js");

test("an order is charged its total", async () => {
  reset();
  const result = await payOrder({ id: "o1", totalCents: 4990 });
  assert.equal(result.paid, true);
  assert.deepEqual(
    charges.map((charge) => charge.amount),
    [4990],
  );
});
`;

const RETRY_TEST = `const { test } = require("node:test");
const assert = require("node:assert");
const { charges, reset } = require("../vendor/payflow/index.js");
const { payOrder } = require("../src/checkout.js");

test("a paid order is charged once", async () => {
  reset();
  await payOrder({ id: "o2", totalCents: 1200 });
  assert.equal(charges.length, 1);
});
`;

const fire = (repo: Repo, event: HookEvent, extra: Record<string, unknown> = {}): Promise<HookOutcome> => {
  const runtime = repoRuntime({ gh: NO_PR });
  return runHook(event, {
    stdin: stdinFrom(JSON.stringify({ session_id: "s1", cwd: repo.root, hook_event_name: event, ...extra })),
    deadlineMs: 120_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t,
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const edited = async (repo: Repo, path: string, text: string): Promise<void> => {
  repo.write(path, text);
  await fire(repo, "PostToolUse", { tool_name: "Write", tool_input: { file_path: join(repo.root, path) } });
};

const chargeRetry = async (): Promise<Repo> => {
  const repo = makeRepo({
    "package.json": `${JSON.stringify({ name: "checkout", private: true, scripts: { test: "node --test" } })}\n`,
    "vendor/payflow/index.js": PAYFLOW,
    "src/checkout.js": CHECKOUT,
    "test/checkout.test.js": ORIGINAL_TEST,
  });
  repos.push(repo);
  await fire(repo, "SessionStart", { source: "startup" });
  return repo;
};

const work = async (repo: Repo): Promise<void> => {
  await edited(repo, "src/checkout.js", RETRYING);
  await edited(repo, "test/checkout-retry.test.js", RETRY_TEST);
};

const stop = (repo: Repo): Promise<HookOutcome> =>
  fire(repo, "Stop", { stop_hook_active: false, last_assistant_message: CLAIM });

describe("Stop gate: uncommitted session changes (charge-retry)", () => {
  it("allows the verified claim on the implicit contract and notes what is not committed", async () => {
    const repo = await chargeRetry();
    await fire(repo, "UserPromptSubmit", { prompt: "finitemonkey: trust implicit" });
    await work(repo);
    const outcome = await stop(repo);
    assert.equal(outcome.verdict, "allow", outcome.stdout);
    assert.match(String(field(parseBody(outcome.stdout), "systemMessage")), /Gate green/);
    const run = runGate({
      runtime: repoRuntime({ gh: NO_PR }),
      cwd: repo.root,
      env: {},
      sessionId: "s1",
      budgetMs: 60_000,
      fast: true,
    });
    if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
    const item = run.report.items.find((entry) => entry.id === "worktree");
    assert.equal(item?.status, "passed");
    const uncommitted = item.notes.find((entry) => entry.key === "gate.worktree.uncommitted");
    assert.deepEqual(uncommitted?.params, { files: "src/checkout.js, test/checkout-retry.test.js" });
  });

  it("still holds unpushed commits on the implicit contract", async () => {
    const repo = await chargeRetry();
    const remote = makeRepo();
    repos.push(remote);
    remote.git("config", "receive.denyCurrentBranch", "ignore");
    repo.git("remote", "add", "origin", remote.root);
    repo.git("push", "-q", "origin", "main");
    await work(repo);
    repo.commit("feat: retry the payment on timeout");
    await edited(repo, "test/checkout-retry.test.js", RETRY_TEST.replace("o2", "o3"));
    const outcome = await stop(repo);
    assert.equal(outcome.verdict, "block");
    const reason = String(field(parseBody(outcome.stdout), "reason"));
    assert.match(reason, /1 commit on main exists only on this machine/);
    assert.doesNotMatch(reason, /not committed/);
  });

  it("still holds the claim on a task contract", async () => {
    const repo = await chargeRetry();
    const created = createTask(repoRuntime(), fmPaths(repo.root), {
      id: "t1",
      goal: "retry the payment on timeout",
      size: "S",
      base: repo.git("rev-parse", "HEAD").trim(),
      paths: [],
      runs: [],
      tests: "node --test",
      git: [],
      manual: [],
      budget: undefined,
    });
    assert.ok(created.ok);
    await work(repo);
    const outcome = await stop(repo);
    assert.equal(outcome.verdict, "block");
    const reason = String(field(parseBody(outcome.stdout), "reason"));
    assert.match(reason, /worktree: files changed in this session are not committed: src\/checkout\.js/);
  });
});
