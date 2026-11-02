import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadFamilies } from "../scripts/bench-family.js";
import { analyse, bundleDecision, featureRows, primaryVerdict } from "../scripts/bench-people-analysis.js";
import { parseDataset, type SessionRecord } from "../scripts/bench-people-data.js";
import { balance, parseProtocol, type Protocol, schedule } from "../scripts/bench-people-plan.js";
import { renderReport, SYNTHETIC_BANNER } from "../scripts/bench-people-report.js";
import { pairedInterval, signFlipP, tCritical } from "../scripts/bench-people-stats.js";
import { jsonLines } from "../scripts/bench-transcript.js";
import { ROOT } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures", "people-synthetic");

const committed = (): Protocol => {
  const parsed = parseProtocol(JSON.parse(readFileSync(join(ROOT, "bench", "people", "protocol.json"), "utf8")));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  return parsed.value;
};

const fixture = (name: string) => jsonLines(readFileSync(join(FIXTURES, name), "utf8"));

const PERSON = {
  synthetic: true,
  participant: "B01",
  profile: "beginner",
  withdrawn: false,
  recordingConsent: false,
  perceivedSpeedupPercent: null,
};

const sessionRow = (task: string, extra: Record<string, unknown> = {}) => ({
  synthetic: true,
  participant: "B01",
  task,
  arm: "fm",
  claimedDone: true,
  oracleGreen: true,
  trapGreen: null,
  wallSeconds: 600,
  tokens: 1000,
  stopped: "done",
  ...extra,
});

describe("people study protocol", () => {
  it("accepts the committed protocol and rejects broken ones", () => {
    assert.equal(committed().perProfile, 5);
    assert.equal(parseProtocol({ ...committed(), tasks: ["a", "b", "c"] }).ok, false);
    assert.equal(parseProtocol({ ...committed(), tasks: ["a", "a"] }).ok, false);
    assert.equal(parseProtocol({ ...committed(), seed: -1 }).ok, false);
    assert.equal(parseProtocol({ ...committed(), perProfile: 0 }).ok, false);
  });

  it("gives the same schedule for the same seed and a different one for another seed", () => {
    assert.deepEqual(schedule(committed()), schedule(committed()));
    assert.notDeepEqual(schedule(committed()), schedule({ ...committed(), seed: committed().seed + 1 }));
  });

  for (const seed of [251, 1, 2, 99]) {
    it(`balances arms within each person and across tasks for seed ${String(seed)}`, () => {
      const protocol = { ...committed(), seed };
      const slots = schedule(protocol);
      assert.equal(slots.length, 2 * (protocol.perProfile + protocol.spares));
      for (const slot of slots) {
        const arms = slot.sessions.map((session) => session.arm);
        assert.equal(arms.filter((arm) => arm === "fm").length, protocol.tasks.length / 2, slot.id);
        assert.ok(
          arms.every((arm, index) => index === 0 || arm !== arms[index - 1]),
          `${slot.id} alternates`,
        );
        assert.deepEqual([...slot.sessions.map((session) => session.task)].sort(), [...protocol.tasks].sort());
      }
      for (const row of balance(slots, protocol.tasks)) assert.equal(row.fm, row.plain, row.task);
      const primary = slots.filter((slot) => !slot.spare);
      assert.equal(primary.filter((slot) => slot.sessions[0]?.arm === "fm").length, primary.length / 2);
    });
  }

  it("names only task families the bench has", () => {
    const families = loadFamilies(join(ROOT, "bench", "tasks"), "public");
    assert.ok(families.ok, families.ok ? "" : families.error);
    for (const task of committed().tasks)
      assert.ok(
        families.value.some((family) => family.id === task),
        task,
      );
  });

  it("marks the spare slots used to replace withdrawals", () => {
    const slots = schedule(committed());
    assert.deepEqual(
      slots.filter((slot) => slot.spare).map((slot) => slot.id),
      ["B06", "B07", "B08", "E06", "E07", "E08"],
    );
  });
});

describe("people study statistics", () => {
  it("computes the exact sign-flip p over every sign assignment", () => {
    assert.equal(signFlipP([1, 1]), 0.5);
    assert.equal(signFlipP([0, 0, 0]), 1);
    assert.equal(signFlipP([-1, -1, -1, -1, -1]), 2 / 32);
    assert.equal(signFlipP([]), undefined);
  });

  it("computes the paired t interval", () => {
    const estimate = pairedInterval([1, 2, 3]);
    assert.ok(estimate !== undefined);
    assert.equal(estimate.estimate, 2);
    assert.ok(Math.abs(estimate.high - (2 + tCritical(2) / Math.sqrt(3))) < 1e-12);
    assert.equal(pairedInterval([1]), undefined);
  });

  it("decides the primary verdict by where the interval sits", () => {
    assert.match(primaryVerdict({ n: 10, estimate: -0.3, low: -0.5, high: -0.1 }), /lowered/);
    assert.match(primaryVerdict({ n: 10, estimate: 0.3, low: 0.1, high: 0.5 }), /raised/);
    assert.match(primaryVerdict({ n: 10, estimate: -0.1, low: -0.4, high: 0.2 }), /not shown/);
    assert.match(primaryVerdict(undefined), /not enough/);
  });

  it("drops a feature dismissed over 10% only after enough showings", () => {
    const session = (shown: number, dismissed: number): SessionRecord => ({
      participant: "B01",
      task: "cart-total",
      assigned: "fm",
      ran: "fm",
      claimedDone: true,
      oracleGreen: true,
      trapGreen: null,
      wallSeconds: 600,
      tokens: null,
      stopped: "done",
      features: { slop: { shown, dismissed } },
    });
    assert.match(featureRows([session(4, 4)])[0]?.verdict ?? "", /too few/);
    assert.match(featureRows([session(10, 2)])[0]?.verdict ?? "", /drop/);
    assert.match(featureRows([session(10, 1)])[0]?.verdict ?? "", /kept/);
  });
});

describe("people study data", () => {
  const slots = schedule(committed());

  it("refuses records without the synthetic flag or that mix synthetic and real", () => {
    const task = slots[0]?.sessions[0]?.task ?? "";
    assert.equal(parseDataset([{ ...PERSON, synthetic: undefined }], [], slots).ok, false);
    assert.equal(parseDataset([PERSON], [sessionRow(task, { synthetic: false })], slots).ok, false);
  });

  it("refuses sessions the schedule does not have, wrong profiles, duplicates and withdrawn data", () => {
    const task = slots[0]?.sessions[0]?.task ?? "";
    assert.equal(parseDataset([PERSON], [sessionRow("not-a-task")], slots).ok, false);
    assert.equal(parseDataset([{ ...PERSON, profile: "experienced" }], [], slots).ok, false);
    assert.equal(parseDataset([PERSON], [sessionRow(task), sessionRow(task)], slots).ok, false);
    assert.equal(parseDataset([{ ...PERSON, withdrawn: true }], [sessionRow(task)], slots).ok, false);
    assert.equal(parseDataset([PERSON], [sessionRow(task, { stopped: "finished" })], slots).ok, false);
    assert.equal(parseDataset([PERSON], [sessionRow(task)], slots).ok, true);
  });

  it("keeps every committed fixture record marked synthetic", () => {
    for (const row of [...fixture("participants.jsonl"), ...fixture("sessions.jsonl")])
      assert.equal(row["synthetic"], true);
  });
});

describe("people study analysis on synthetic fixtures", () => {
  const slots = schedule(committed());
  const parsed = parseDataset(fixture("participants.jsonl"), fixture("sessions.jsonl"), slots);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error.join("\n"));
  const analysis = analyse(parsed.value, slots);

  it("analyses by assigned arm and leaves the withdrawn slot out", () => {
    assert.equal(analysis.analysed.length, 10);
    assert.ok(!analysis.analysed.includes("E05"));
    assert.deepEqual(
      analysis.deviations.map((session) => session.participant),
      ["E03"],
    );
    assert.deepEqual(
      analysis.totals.map((totals) => [totals.arm, totals.sessions, totals.falseDone]),
      [
        ["plain", 20, 7],
        ["fm", 20, 6],
      ],
    );
    assert.equal(analysis.primary?.n, 10);
    assert.equal(bundleDecision(analysis), "do not claim a benefit: not shown");
  });

  it("labels the report as synthetic and never as real sessions", () => {
    const text = renderReport({ analysis, hashes: { "docs/bench/people.md": "abc" } });
    assert.ok(text.includes(SYNTHETIC_BANNER));
    assert.ok(!text.includes("Real sessions"));
    assert.match(text, /\| all \| plain \| 20 \| 18 \| 11 \| 7 \|/);
  });
});
