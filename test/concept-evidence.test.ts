import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { creditGate } from "../src/conceitos/credit.js";
import {
  type ConceptEvent,
  type ConceptEventDraft,
  readConceptEvents,
  recordConceptEvents,
  stateOf,
  summarize,
  WEIGHTS,
} from "../src/conceitos/evidence.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { writeGateStatus } from "../src/gate/hooks/status.js";
import { perfilPrompt } from "../src/perfil/hooks.js";
import { readProfile } from "../src/perfil/store.js";
import { fmPaths } from "../src/task/paths.js";
import { hook, runtime, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const event = (draft: ConceptEventDraft, index: number): ConceptEvent => ({
  at: `2026-10-0${String(index + 1)}T00:00:00Z`,
  ...draft,
  weight: WEIGHTS[draft.kind],
});

const events = (...kinds: readonly ConceptEventDraft["kind"][]): readonly ConceptEvent[] =>
  kinds.map((kind, index) => event({ concept: "webhook", kind, origin: "person" }, index));

const CONTRACT = [
  "id: t1",
  "goal: handle the payment webhook",
  "size: S",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node -e 0",
  "",
].join("\n");

const repo = (): TempRepo => {
  const made = tempRepo({ "src/a.js": "export const a = 1;\n" });
  repos.push(made);
  write(made.root, ".finitemonkey/policy.yml", "guards: {}\n");
  trustContract(made.root, "t1", CONTRACT);
  return made;
};

const agentEdit = (file: string): string =>
  `${JSON.stringify({ at: "2026-10-29T00:00:00Z", session: "s", turn: 1, kind: "edit", file, hash: "h", undo: false })}\n`;

describe("concept evidence", () => {
  it("a prompt full of domain words leaves the knowledge axis where it was and counts only as exposure", async () => {
    const made = repo();
    const before = readProfile(runtime, fmPaths(made.root));
    const raw: JsonObject = { prompt: "Add an idempotency key to the webhook and a migration for the API" };
    await hook(perfilPrompt, "UserPromptSubmit", made.root, raw);
    assert.deepEqual(readProfile(runtime, fmPaths(made.root)), before);
    const logged = readConceptEvents(runtime, fmPaths(made.root));
    assert.ok(logged.length >= 3);
    assert.ok(logged.every((item) => item.kind === "exposure" && item.weight === 0));
    assert.equal(summarize("webhook", logged).state, "beyond");
  });

  it("states come from counted evidence, keep no record apart from beyond, and go down after a failure", () => {
    assert.equal(stateOf([]), "unknown");
    assert.equal(stateOf(events("exposure", "exposure")), "beyond");
    assert.equal(stateOf(events("own_change")), "proximal");
    assert.equal(stateOf(events("own_change", "prediction_right", "own_repair")), "demonstrated");
    assert.equal(stateOf(events("own_change", "prediction_right", "own_repair", "failure_after_approval")), "proximal");
    assert.equal(stateOf(events("own_change", "failure_after_approval")), "beyond");
  });

  it("an agent can never log a demonstration for the person", () => {
    const made = repo();
    const paths = fmPaths(made.root);
    recordConceptEvents(runtime, paths, [
      { concept: "webhook", kind: "own_change", origin: "agent" },
      { concept: "webhook", kind: "own_repair", origin: "agent" },
      { concept: "webhook", kind: "prediction_right", origin: "agent" },
    ]);
    const logged = readConceptEvents(runtime, paths);
    assert.deepEqual(
      logged.map((item) => [item.kind, item.weight]),
      [
        ["exposure", 0],
        ["exposure", 0],
        ["exposure", 0],
      ],
    );
  });

  it("a gate turning green credits the person's files as a repair and logs the agent's files as exposure", async () => {
    const made = repo();
    const paths = fmPaths(made.root);
    write(made.root, "src/hooks/webhook.js", "export const onWebhook = () => 1;\n");
    write(made.root, "src/agent.js", "export const idempotencyKey = (id) => id; // webhook\n");
    runtime.appendText(toAbsolutePath(`${paths.dir}/signals.jsonl`), agentEdit("src/agent.js"));
    const gate = await cliJson(["gate"], { cwd: made.root, runtime: repoRuntime() });
    assert.equal(field(gate.body, "data", "verdict"), "passed", gate.stdout);
    const tree = String(field(gate.body, "data", "treeHash"));
    writeGateStatus(runtime, paths, { status: "failed", task: "t1", detail: "", tree: "earlier" });
    creditGate(runtime, paths);
    writeGateStatus(runtime, paths, { status: "passed", task: "t1", detail: "", tree });
    assert.ok(creditGate(runtime, paths).length > 0);
    const logged = readConceptEvents(runtime, paths);
    const mine = logged.filter((item) => item.file === "src/hooks/webhook.js");
    const theirs = logged.filter((item) => item.file === "src/agent.js");
    assert.deepEqual(
      mine.map((item) => [item.concept, item.kind, item.origin]),
      [["webhook", "own_repair", "person"]],
    );
    assert.ok(theirs.length > 0);
    assert.ok(theirs.every((item) => item.kind === "exposure" && item.origin === "agent"));
    assert.equal(creditGate(runtime, paths).length, 0);
  });
});
