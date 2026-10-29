import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ConceptId } from "../src/conceitos/concepts.js";
import { type ConceptEvent, WEIGHTS } from "../src/conceitos/evidence.js";
import {
  BUDGET,
  budgetFor,
  EMPTY_STATE,
  gapOf,
  type Probe,
  type ProbeKind,
  type ProbeState,
  settle,
} from "../src/conceitos/probes.js";
import { type ProbeDraft, proposeProbe, readProbeState } from "../src/conceitos/probes-run.js";
import { selfGuard } from "../src/guards/self/hook.js";
import { fmPaths } from "../src/task/paths.js";
import { bash, hook, runtime, type TempRepo, tempRepo } from "./git-support.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-29T12:00:00Z");
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const exit = (code: number): string => `node -e "process.exit(${String(code)})"`;
const print = (text: string): string => `node -e "console.log('${text}')"`;

const draft = (kind: ProbeKind, extra: Partial<ProbeDraft>): ProbeDraft => ({
  kind,
  concept: "idempotency",
  question: "what does this block return?",
  why: "this block uses idempotency and nothing on record covers it",
  options: [
    { id: "a", text: "refund 50 to card" },
    { id: "b", text: "nothing to refund" },
  ],
  ...extra,
});

const probe = (
  id: string,
  concept: ConceptId,
  status: Probe["status"],
  days: number,
  kind: ProbeKind = "predict",
  shown = true,
): Probe => ({
  id,
  kind,
  concept,
  domain: "backend",
  question: "q",
  why: "w",
  options: [],
  key: "a",
  status,
  at: ago(days),
  answeredAt: ago(days),
  ...(shown ? { presentedAt: ago(days) } : {}),
});

const event = (concept: ConceptId, kind: ConceptEvent["kind"], days: number): ConceptEvent => ({
  at: ago(days),
  concept,
  kind,
  origin: "person",
  weight: WEIGHTS[kind],
});

const terms = (count: number): readonly ConceptEvent[] =>
  Array.from({ length: count }, (_, index) => event("idempotency", "exposure", 20 - index));

describe("probes", () => {
  it("every probe type gets its answer key from running the code, and an ambiguous run discards the probe", () => {
    const repo = tempRepo();
    repos.push(repo);
    const paths = fmPaths(repo.root);
    runtime.mkdir(paths.dir);
    const cases: readonly [ProbeKind, Partial<ProbeDraft>, string | null, Probe["status"]][] = [
      ["predict", { run: print("nothing to refund") }, "b", "open"],
      ["what_if", { run: print("refund 50 to card") }, "a", "open"],
      [
        "variant",
        {
          options: [
            { id: "a", text: "version A", run: exit(0) },
            { id: "b", text: "version B", run: exit(1) },
          ],
        },
        "b",
        "open",
      ],
      [
        "order",
        {
          options: [
            { id: "a", text: "column, backfill, read", run: exit(0) },
            { id: "b", text: "read, column", run: exit(3) },
          ],
        },
        "a",
        "open",
      ],
      [
        "relation",
        {
          options: [
            { id: "a", text: "a repeated webhook", run: exit(0) },
            { id: "b", text: "two users", run: exit(1) },
          ],
        },
        "a",
        "open",
      ],
      ["language", {}, null, "open"],
      [
        "variant",
        {
          options: [
            { id: "a", text: "A", run: exit(1) },
            { id: "b", text: "B", run: exit(1) },
          ],
        },
        null,
        "invalid",
      ],
      ["predict", { run: print("something else") }, null, "invalid"],
    ];
    for (const [kind, extra, key, status] of cases) {
      const made = proposeProbe(runtime, paths, draft(kind, extra));
      assert.deepEqual([made.key, made.status], [key, status], kind);
    }
    assert.equal(readProbeState(runtime, paths).probes.length, cases.length);
  });

  it("a single failed probe or a single confirmed wrong relation changes nothing visible", () => {
    const one: ProbeState = { ...EMPTY_STATE, probes: [probe("P1", "idempotency", "wrong", 1)] };
    assert.equal(gapOf("backend", one, terms(10), NOW).state, "no_data");
    const relation: ProbeState = {
      ...EMPTY_STATE,
      probes: [probe("P1", "idempotency", "wrong", 1, "clarify")],
    };
    assert.equal(gapOf("backend", relation, terms(10), NOW).state, "no_data");
    const budget = budgetFor(one, { concept: "webhook", domain: "backend" }, "s2", NOW, [], new Set());
    assert.equal(budget.ok, true);
  });

  it("a relation error counts only after the clarifying question is answered, and only with the other families", () => {
    const wrong = [
      probe("P1", "idempotency", "wrong", 3),
      probe("P2", "idempotency", "wrong", 4),
      probe("P3", "webhook", "wrong", 5),
      probe("P4", "webhook", "wrong", 6),
      probe("P5", "migration", "wrong", 7),
      probe("P6", "api", "right", 8),
    ];
    const open = (id: string): Probe => ({ ...probe(id, "idempotency", "open", 2, "clarify"), presentedAt: ago(2) });
    const asked: ProbeState = { ...EMPTY_STATE, probes: [...wrong, open("C1"), open("C2")] };
    assert.equal(gapOf("backend", asked, terms(10), NOW).state, "watching");
    const answered: ProbeState = {
      ...EMPTY_STATE,
      probes: [
        ...wrong,
        probe("C1", "idempotency", "wrong", 2, "clarify"),
        probe("C2", "webhook", "wrong", 2, "clarify"),
      ],
    };
    const gap = gapOf("backend", answered, terms(10), NOW);
    assert.deepEqual([gap.state, gap.confirmedRelations], ["sustained", 2]);
    const repaired = gapOf("backend", answered, [...terms(10), event("idempotency", "own_change", 5)], NOW);
    assert.equal(repaired.state, "watching");
    const right = gapOf(
      "backend",
      { ...answered, probes: [...answered.probes, probe("P7", "webhook", "right", 1)] },
      terms(10),
      NOW,
    );
    assert.notEqual(right.state, "sustained");
  });

  it("the budget holds per session, week and domain, three skips pause a domain and two right answers fade a concept", () => {
    const presented = (id: string, days: number, session: string, domain: Probe["domain"] = "backend"): Probe => ({
      ...probe(id, "api", "right", days),
      domain,
      session,
    });
    const ask = (state: ProbeState, session: string, domain: Probe["domain"] = "backend") =>
      budgetFor(state, { concept: "webhook", domain }, session, NOW, [], new Set());
    assert.deepEqual(ask({ ...EMPTY_STATE, probes: [presented("P1", 0, "s1")] }, "s1"), {
      ok: false,
      reason: "session",
    });
    const twoBackend = { ...EMPTY_STATE, probes: [presented("P1", 1, "a"), presented("P2", 2, "b")] };
    assert.deepEqual(ask(twoBackend, "s3"), { ok: false, reason: "domain" });
    assert.deepEqual(ask(twoBackend, "s3", "security").ok, true);
    const five = {
      ...EMPTY_STATE,
      probes: (["interface", "security", "infrastructure", "product", "backend"] as const).map((domain, index) =>
        presented(`P${String(index)}`, 1, `s${String(index)}`, domain),
      ),
    };
    assert.equal(five.probes.length, BUDGET.perWeek);
    assert.deepEqual(ask(five, "new", "security"), { ok: false, reason: "week" });
    assert.equal(ask({ ...EMPTY_STATE, probes: [presented("P1", 8, "old")] }, "s9").ok, true);

    let skipping: ProbeState = {
      ...EMPTY_STATE,
      probes: ["S1", "S2", "S3"].map((id) => probe(id, "migration", "open", 1, "predict", false)),
    };
    for (const id of ["S1", "S2", "S3"]) skipping = settle(skipping, id, undefined, ago(0));
    assert.deepEqual(ask({ ...skipping, probes: [] }, "s9"), { ok: false, reason: "paused" });

    const faded: ProbeState = {
      ...EMPTY_STATE,
      probes: [
        probe("F1", "webhook", "right", 40, "predict", false),
        probe("F2", "webhook", "right", 3, "predict", false),
      ],
    };
    assert.deepEqual(ask(faded, "s9"), { ok: false, reason: "faded" });
    const back = budgetFor(
      faded,
      { concept: "webhook", domain: "backend" },
      "s9",
      NOW,
      [event("webhook", "failure_after_approval", 1)],
      new Set(),
    );
    assert.equal(back.ok, true);
    const sustained = budgetFor(
      twoBackend,
      { concept: "webhook", domain: "backend" },
      "s3",
      NOW,
      [],
      new Set(["backend"]),
    );
    assert.equal(sustained.ok, true);
  });

  it("only the person answers or skips a probe", async () => {
    const repo = tempRepo();
    repos.push(repo);
    for (const command of ["fm probe answer P1 a", "finitemonkey probe skip P1"]) {
      const decision = await hook(selfGuard, "PreToolUse", repo.root, bash(command));
      assert.equal(decision.kind, "block", command);
    }
    assert.equal((await hook(selfGuard, "PreToolUse", repo.root, bash("fm probe next"))).kind, "allow");
  });
});
