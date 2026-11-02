import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { loadPersonas } from "../scripts/bench-family.js";
import { scoreInstruments } from "../scripts/bench-instruments.js";
import { field, ROOT } from "./support.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const knowledge = () => {
  const loaded = loadPersonas(join(ROOT, "bench", "personas"));
  assert.ok(loaded.ok);
  const found = loaded.value.find((persona) => persona.id === "layperson");
  assert.ok(found !== undefined);
  return found.knowledge;
};

const fixture = (files: Readonly<Record<string, readonly object[]>>): string => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-splits-")));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  for (const [path, rows] of Object.entries(files))
    writeFileSync(join(dir, path), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return dir;
};

const AT = "2026-10-30T10:00:00.000Z";
const outcome = (value: string, help: string) => ({
  at: AT,
  event: "horizon.outcome",
  help,
  outcome: value,
  reason: value === "recognizable" ? "accepted" : "ignored",
  domain: "security",
});

describe("level round: each split against the persona's scripted profile", () => {
  it("reports agreement per split and keeps the splits in calibration", () => {
    const dir = fixture({
      "log.jsonl": [outcome("out_of_reach", "h1"), outcome("out_of_reach", "h2"), outcome("recognizable", "h3")],
    });
    const scored = scoreInstruments(dir, { knowledge: knowledge(), fmDomain: "security", fmConcepts: [] });
    assert.equal(field(scored, "splits", "status"), "calibration");
    assert.deepEqual(field(scored, "splits", "horizon"), {
      lower: 1,
      upper: 2,
      expected: "outOfReach",
      verdict: "right",
    });
    assert.equal(field(scored, "splits", "alone", "verdict"), "right");
    assert.equal(field(scored, "splits", "proximal", "verdict"), "right");
  });

  it("a known context success in a domain the persona masters disagrees with the transfer profile", () => {
    const change = (file: string, day: number) => ({
      at: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
      concept: "api",
      kind: "own_change",
      origin: "person",
      weight: 1,
      file,
    });
    const dir = fixture({
      "conceitos-events.jsonl": [
        change("src/api/a.ts", 1),
        change("src/api/b.ts", 2),
        change("src/api/c.ts", 3),
        change("src/api/d.ts", 4),
      ],
    });
    const scored = scoreInstruments(dir, { knowledge: { backend: "within" }, fmDomain: "backend", fmConcepts: [] });
    assert.deepEqual(field(scored, "splits", "alone"), { lower: 1, upper: 0, expected: "transfer", verdict: "wrong" });
    assert.equal(field(scored, "splits", "horizon", "verdict"), "no-evidence");
  });
});
