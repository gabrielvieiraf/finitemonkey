import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { report } from "../scripts/bench-analysis-lib.js";
import { type Arm, loadArms } from "../scripts/bench-arms.js";
import { parseBenchArgs, realRunProblems } from "../scripts/bench-cli.js";
import { type Family, loadFamilies, loadPersonas, type Persona } from "../scripts/bench-family.js";
import { loadPhase, type Phase, phaseEstimate, phaseProblems, phaseRuns } from "../scripts/bench-phase.js";
import { amend, verifyFrozen } from "../scripts/bench-prereg.js";
import { type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { ROOT } from "./support.js";

const BENCH = join(ROOT, "bench");
const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const scratch = (): string => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-main-round-")));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

const ok = <T>(
  parsed: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
): T => {
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  return parsed.value;
};

const arms = (): readonly Arm[] => ok(loadArms(join(BENCH, "arms")));
const families = (): readonly Family[] => ok(loadFamilies(join(BENCH, "tasks"), "public"));
const personas = (): readonly Persona[] => ok(loadPersonas(join(BENCH, "personas")));
const main = (): Phase => ok(loadPhase(BENCH, "main"));
const turnsOf = (task: string): number =>
  1 + (personas().find((persona) => task.endsWith(`.${persona.id}`))?.behavior.maxFollowUps ?? 0);

describe("main round configuration", () => {
  it("names only families, personas and arms that exist, and every main family is in it", () => {
    assert.deepEqual(phaseProblems(main(), families(), personas(), arms()), []);
    const planned = new Set(main().groups.flatMap((group) => group.families));
    for (const family of families().filter((item) => item.phase === "main"))
      assert.ok(planned.has(family.id), family.id);
  });

  it("plans plain against fm three times on every family, ricochet arms once on the research families, interleaved", () => {
    const runs = phaseRuns(main(), 2);
    assert.equal(runs.length, 75);
    assert.deepEqual(
      runs.map((run) => run.order),
      runs.map((_, index) => index),
    );
    assert.equal(new Set(runs.map((run) => run.id)).size, runs.length);
    const primary = runs.slice(0, 66);
    for (let index = 0; index < primary.length; index += 2) {
      const [first, second] = [primary[index], primary[index + 1]];
      assert.ok(first !== undefined && second !== undefined);
      assert.equal(first.task, second.task);
      assert.deepEqual([first.arm, second.arm].sort(), ["fm", "plain"]);
      assert.equal(first.taskSeed, second.taskSeed);
    }
    const ricochet = runs.slice(66);
    assert.ok(ricochet.every((run) => ["no-detector", "horizon", "horizon-criterion"].includes(run.arm)));
    for (const run of ricochet) {
      const pair = primary.find((item) => item.task === run.task && item.repeat === 0);
      assert.equal(run.taskSeed, pair?.taskSeed, "same instance as the first primary repeat");
    }
    assert.deepEqual(phaseRuns(main(), 2), runs);
  });

  it("the estimate comes from the pilot's measured cost and keeps the worst case under the cap", () => {
    const runs = phaseRuns(main(), 2);
    const estimate = phaseEstimate(main(), runs, arms(), turnsOf, main().maxBudgetUsd);
    assert.equal(estimate.sessions, 75);
    assert.ok(Math.abs(estimate.worstUsd - 112.5) < 1e-9, String(estimate.worstUsd));
    assert.equal(estimate.withinCap, true);
    assert.deepEqual(
      estimate.expectedUsd.map((value) => value.toFixed(2)),
      ["12.50", "20.83"],
    );
    const over = phaseEstimate(main(), runs, arms(), turnsOf, 1);
    assert.equal(over.withinCap, false);
    assert.match(
      realRunProblems({
        yes: true,
        tty: true,
        sessions: 75,
        unpinned: [],
        configDir: "/c",
        configHasInstructions: false,
        overCap: "the worst case US$ 150.00 is over the phase cap; lower --max-budget-usd",
      }).join("\n"),
      /over the phase cap/,
    );
  });

  it("--phase replaces --tasks, --arms and --repeats", () => {
    assert.equal(parseBenchArgs(["--seed", "2", "--phase", "main", "--tasks", "x"]).ok, false);
    const parsed = ok(parseBenchArgs(["--seed", "2", "--phase", "main", "--dry-run"]));
    assert.deepEqual([parsed.phase, parsed.maxBudgetUsd], ["main", undefined]);
    assert.equal(loadPhase(BENCH, "nope").ok, false);
  });

  it("the dry run prints the schedule and the estimate and spends nothing", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", join(ROOT, "scripts", "bench.ts"), "--seed", "2", "--phase", "main", "--dry-run"],
      { cwd: ROOT, encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /phase main: 75 sessions, onboarding self-report/);
    assert.match(result.stdout, /expected cost US\$ 12\.50 to 20\.83/);
    assert.match(result.stdout, /worst case US\$ 112\.50/);
    assert.match(result.stdout, /^ {2}0 \S+--(?:plain|fm)--r0--s2 task seed \d+$/m);
    assert.match(result.stdout, /^ 74 /m);
  });

  it("a dry run with --tasks still works for any hand-picked list", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(ROOT, "scripts", "bench.ts"),
        "--seed",
        "2",
        "--tasks",
        "notes-idor.layperson,growth-figure.layperson",
        "--arms",
        "plain,fm",
        "--repeats",
        "1",
        "--max-budget-usd",
        "0.75",
        "--dry-run",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /4 sessions of up to 2 turns, at most US\$ 6\.00/);
  });
});

describe("the lock covers the main round", () => {
  it("the committed lock matches the personas, task families and phase files", () => {
    ok(verifyFrozen(BENCH));
    const lock = ok(parseJsonObject(readFileSync(join(BENCH, "PREREGISTRATION.lock.json"), "utf8")));
    assert.equal(lock["frozenAt"], "2026-10-29");
    const amendments = lock["amendments"];
    assert.ok(Array.isArray(amendments) && amendments.length > 0);
  });

  it("an amendment keeps the frozen text and date, and a later change to an oracle is refused", () => {
    const copy = scratch();
    cpSync(BENCH, copy, { recursive: true, filter: (path) => !path.includes("results") });
    const nothing = amend(copy, "2026-10-31", "no change");
    assert.equal(nothing.ok, false);
    const oracle = join(copy, "tasks", "notes-idor", "oracle", "trap.test.mjs");
    writeFileSync(oracle, `${readFileSync(oracle, "utf8")}\n// loosened\n`);
    const refused = verifyFrozen(copy);
    assert.match(refused.ok ? "" : refused.error, /task families changed/);
    const amended = ok(amend(copy, "2026-10-31", "test"));
    assert.deepEqual(amended.changed, ["tasks/notes-idor"]);
    const frozen = ok(verifyFrozen(copy));
    assert.equal(frozen.frozenAt, "2026-10-29");
    writeFileSync(join(copy, "PREREGISTRATION.md"), "# changed\n");
    assert.equal(amend(copy, "2026-10-31", "text").ok, false);
  });
});

describe("analysis tables", () => {
  const run = (arm: string, extra: JsonObject): JsonObject => ({
    family: "charge-retry",
    arm,
    kind: "code",
    costUsd: 0.2,
    durationMs: 60_000,
    ...extra,
  });

  it("counts shares over the runs that have the field, and leaves non-applicable verdicts out", () => {
    const records = [
      run("fm", {
        oracleGreen: true,
        falseDone: false,
        unsafe: false,
        trapSurfaced: true,
        instruments: {
          collected: true,
          perfil: { taskDomain: "right" },
          xray: { verdict: "right" },
          blindBand: { verdict: "right", falsePositives: ["product"] },
          probes: { verdict: "false-positive", falsePositives: [{ domain: "product" }] },
          trajectory: { verdict: "still" },
          judge: { verdict: "absent" },
        },
      }),
      run("fm", {
        oracleGreen: false,
        falseDone: true,
        unsafe: true,
        trapSurfaced: false,
        instruments: { collected: true, perfil: { taskDomain: "not-a-perfil-domain" }, xray: { verdict: "absent" } },
      }),
      run("plain", { oracleGreen: false, falseDone: true, unsafe: true, trapSurfaced: false, instruments: null }),
    ];
    const text = report(records, undefined);
    assert.match(text, /\| charge-retry \| fm \| 2 \| 1\/2 \| 1\/2 \| 1\/2 \| 1\/2 \| - \| 0\.200 \| 60 \|/);
    assert.match(text, /\| charge-retry \| plain \| 1 \| 0\/1 \| 1\/1 \| 1\/1 \| 0\/1 \| - \| 0\.200 \| 60 \|/);
    assert.match(
      text,
      /\| charge-retry \| fm \| 2\/2 \| 1\/1 \| 1\/2 \| 1\/2 \| 1\/1 \| 1 \| 0\/1 \| 1 \| 0\/1 \| - \|/,
    );
    assert.equal(text.split("| charge-retry | plain |").length - 1, 1, "plain runs have no instrument row");
  });
});
