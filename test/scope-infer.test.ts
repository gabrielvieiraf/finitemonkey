import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { diffCheck } from "../src/gate/checks/diff.js";
import { prepareGate } from "../src/gate/prepare.js";
import { saveRelease } from "../src/guards/release/grants.js";
import type { HookEvent } from "../src/hooks/events.js";
import { composeDecisions, type HookHandler, type HookInput } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { withPolicy } from "../src/policy/guards.js";
import { POLICY_FILE } from "../src/policy/policy.js";
import { implicitContract } from "../src/task/implicit.js";
import { fmPaths } from "../src/task/paths.js";
import { FRONT_SCOPE_GUARD, frontScopeGuard, SCOPE_GUARD, scopeAfterEdit } from "../src/task/scope-hooks.js";
import { FIRST_EDITS, type InferredScope, observeEdit, readInferred } from "../src/task/scope-infer.js";
import { memoryFs } from "./memory-fs.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { fakeRuntime } from "./support.js";

const t = createTranslator("en");

describe("scope inferred from the first edits", () => {
  it("learns the directories of the first edits, keeps tests in scope, widens once, then flags", () => {
    let scope: InferredScope | undefined;
    const step = (file: string) => {
      const next = observeEdit(scope, "implicit", file);
      scope = next.scope;
      return next.event;
    };
    assert.equal(step("src/cart/total.ts"), "learned");
    assert.equal(step("src/cart/total.ts"), "learned");
    assert.equal(step("src/cart/tax.ts"), "learned");
    assert.equal(FIRST_EDITS, 3);
    assert.equal(step("test/cart.test.ts"), "inside");
    assert.equal(step("src/cart/rounding.ts"), "inside");
    assert.equal(step("src/shared/money.ts"), "widened");
    assert.equal(step("src/shared/format.ts"), "inside");
    assert.equal(step("src/billing/invoice.ts"), "outside");
    assert.deepEqual(scope?.dirs, ["src/cart", "src/shared"]);
  });

  it("starts again when the task changes", () => {
    const first = observeEdit(undefined, "implicit", "src/a/x.ts").scope;
    assert.deepEqual(observeEdit(first, "other", "lib/y.ts").scope.dirs, ["lib"]);
  });

  it("the implicit contract carries a diff check", () => {
    const kinds = implicitContract({ read: () => undefined, exists: () => false }).acceptance.map((c) => c.kind);
    assert.ok(kinds.includes("diff"));
  });
});

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));

const inputOf = (runtime: Runtime, event: HookEvent, raw: Readonly<Record<string, unknown>>): HookInput => {
  const parsed = parseHookPayload(
    event,
    JSON.stringify({ session_id: "s1", cwd: ROOT, hook_event_name: event, ...raw }),
    false,
  );
  assert.ok(parsed.ok);
  return { event, payload: parsed.value, cwd: ROOT, runtime, t, env: {} };
};

const guarded = (id: string, event: HookEvent, handler: HookHandler): readonly HookHandler[] =>
  withPolicy({ id, damage: false, handlers: { [event]: [handler] } })[event] ?? [];

const write = (file: string) => ({ tool_name: "Write", tool_input: { file_path: file, content: "x" } });

describe("edit-time scope warning", () => {
  const setup = (policy?: string) => {
    const fs = memoryFs(policy === undefined ? {} : { [at(POLICY_FILE)]: policy }, [at(".git"), at(".finitemonkey")]);
    return { fs, runtime: fakeRuntime({ fs }) };
  };
  const edit = (runtime: Runtime, file: string) =>
    composeDecisions(
      inputOf(runtime, "PostToolUse", write(at(file))),
      guarded(SCOPE_GUARD, "PostToolUse", scopeAfterEdit),
    );
  const context = (decision: Awaited<ReturnType<typeof composeDecisions>>): string =>
    decision.kind === "allow" ? JSON.stringify(decision.output ?? {}) : "";

  it("warns when an implicit task edits an unrelated module, after one widening", async () => {
    const { runtime } = setup("guards:\n  scope: active\n");
    for (const file of ["src/cart/a.ts", "src/cart/b.ts", "src/cart/c.ts"]) await edit(runtime, file);
    assert.match(context(await edit(runtime, "src/shared/m.ts")), /widened the scope/);
    assert.match(context(await edit(runtime, "src/billing/i.ts")), /src\/billing\/i\.ts is outside the scope/);
    assert.deepEqual(readInferred(runtime, fmPaths(ROOT))?.dirs, ["src/cart", "src/shared"]);
  });

  it("starts in shadow: it records the scope and logs, without telling the agent", async () => {
    const { fs, runtime } = setup();
    for (const file of ["src/cart/a.ts", "src/cart/b.ts", "src/cart/c.ts", "src/shared/m.ts"])
      await edit(runtime, file);
    assert.equal(context(await edit(runtime, "src/billing/i.ts")), "{}");
    assert.match(fs.read(at(".finitemonkey/log.jsonl")) ?? "", /"event":"scope.outside".*"mode":"shadow"/);
  });
});

describe("fronts are held to their declared paths", () => {
  const FRONTS = [
    "fronts:",
    "  - id: cart",
    "    goal: cart totals",
    "    path: /home/ana/wt/cart",
    "    status: running",
    "    scope:",
    "      paths:",
    "        - src/cart/**",
    "      shared:",
    "        append:",
    "          - src/i18n/en.json",
    "",
  ].join("\n");
  const setup = (policy: string) => {
    const fs = memoryFs({ [at(POLICY_FILE)]: policy, [at(".finitemonkey/fronts.yml")]: FRONTS }, [at(".git")]);
    return fakeRuntime({ fs });
  };
  const before = (runtime: Runtime, file: string) =>
    composeDecisions(
      inputOf(runtime, "PreToolUse", write(file)),
      guarded(FRONT_SCOPE_GUARD, "PreToolUse", frontScopeGuard),
    );

  it("an edit outside the front's paths is held; inside, append files and other trees pass", async () => {
    const runtime = setup("guards:\n  front-scope: active\n");
    const held = await before(runtime, "/home/ana/wt/cart/src/billing/invoice.ts");
    assert.ok(held.kind === "block");
    assert.match(held.reason, /outside the paths of front cart \(src\/cart\/\*\*\)/);
    assert.equal((await before(runtime, "/home/ana/wt/cart/src/cart/total.ts")).kind, "allow");
    assert.equal((await before(runtime, "/home/ana/wt/cart/src/i18n/en.json")).kind, "allow");
    assert.equal((await before(runtime, at("src/billing/invoice.ts"))).kind, "allow");
  });

  it("starts in shadow", async () => {
    const runtime = setup("level: standard\n");
    assert.equal((await before(runtime, "/home/ana/wt/cart/src/billing/invoice.ts")).kind, "allow");
  });
});

describe("the gate lists out-of-scope files and records the ones the person accepts", () => {
  const repos: Repo[] = [];
  after(() => {
    for (const repo of repos) repo.cleanup();
  });

  const project = (): Repo => {
    const repo = makeRepo({
      "package.json": "{}\n",
      "src/cart/total.ts": "export const total = 1;\n",
      "src/billing/invoice.ts": "export const invoice = 1;\n",
    });
    repos.push(repo);
    repo.write("src/cart/total.ts", "export const total = 2;\n");
    repo.write("src/billing/invoice.ts", "export const invoice = 2;\n");
    repo.write(".finitemonkey/cache/scope.json", '{"task":"implicit","dirs":["src/cart"],"seen":3,"widened":true}\n');
    return repo;
  };

  const check = (repo: Repo) => {
    const ready = prepareGate({
      runtime: repoRuntime(),
      cwd: repo.root,
      env: {},
      sessionId: undefined,
      budgetMs: 5000,
      fast: false,
      noSkip: true,
    });
    if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
    return diffCheck({ id: "diff", kind: "diff" }, ready.prepared.ctx);
  };

  it("an implicit task that edits an unrelated module gets a scope finding with a reason", () => {
    const outcome = check(project());
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      outcome.notes.map((item) => [item.key, item.params["file"]]),
      [["gate.diff.outside_inferred", "src/billing/invoice.ts"]],
    );
  });

  it("a file the person accepted passes and the acceptance is in the outcome the ledger keeps", () => {
    const repo = project();
    saveRelease(repoRuntime(), fmPaths(repo.root), Date.now(), {
      grants: [],
      approvals: [
        { task: "implicit", check: "diff", reason: "the invoice uses the new total", at: "2026-10-26T12:00:00Z" },
      ],
    });
    const outcome = check(repo);
    assert.equal(outcome.status, "passed");
    assert.equal(outcome.releasedBy, "person@2026-10-26T12:00:00Z");
    assert.deepEqual(outcome.notes[0]?.params, {
      file: "src/billing/invoice.ts",
      reason: "the invoice uses the new total",
      at: "2026-10-26T12:00:00Z",
    });
  });
});
