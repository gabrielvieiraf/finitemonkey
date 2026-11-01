import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConceptId } from "../src/conceitos/concepts.js";
import { type ConceptEvent, type ConceptEventKind, type Origin, WEIGHTS } from "../src/conceitos/evidence.js";
import { type HelpMark, trajectoryOf } from "../src/conceitos/trajectory.js";
import { chartLines } from "../src/conceitos/trajectory-ansi.js";
import { BANDS, GROUP_LABEL } from "../src/conceitos/trajectory-bands.js";
import { ENGLISH_TABLE, rasterCells, rasterOf, svgOf, tableLines } from "../src/conceitos/trajectory-chart.js";
import { wordingProblems } from "../src/conceitos/wording.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-29T12:00:00Z");
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const event = (
  days: number,
  concept: ConceptId,
  kind: ConceptEventKind,
  origin: Origin = "person",
  extra: Partial<ConceptEvent> = {},
): ConceptEvent => ({ at: ago(days), concept, kind, origin, weight: WEIGHTS[kind], ...extra });

const LOG: readonly ConceptEvent[] = [
  event(70, "api", "own_change", "person", { task: "t1", file: "src/api/orders.ts" }),
  event(63, "api", "prediction_right"),
  event(63, "migration", "prediction_right"),
  event(56, "webhook", "exposure", "agent", { task: "t2", file: "src/webhook.ts" }),
  event(49, "migration", "own_change", "person", { task: "t3", file: "db/migrations/1.sql" }),
  event(21, "idempotency", "exposure", "agent", { task: "t4", file: "src/refund.ts" }),
  event(14, "webhook", "failure_after_approval", "person", { task: "t5", file: "src/webhook.ts" }),
  event(7, "idempotency", "failure_after_approval", "person", { task: "t6", file: "src/refund.ts" }),
  event(6, "idempotency", "own_repair", "person", { task: "t6", file: "src/refund.ts" }),
];

const HELPS: readonly HelpMark[] = [
  { at: ago(21), domain: "backend", criterion: "none" },
  { at: ago(21), domain: "backend", criterion: "example" },
];

const decode = (text: string): readonly number[] => [...Buffer.from(text, "base64")];

describe("trajectory", () => {
  const backend = trajectoryOf("backend", LOG, HELPS, NOW);

  it("a fixture event log gives the three series, gaps and ricochet markers", () => {
    assert.equal(backend.status, "ok");
    assert.equal(backend.weeks.length, 12);
    const filled = backend.weeks.filter((week) => week.assisted !== null);
    const gaps = backend.weeks.filter((week) => week.assisted === null);
    assert.ok(filled.length >= 5 && gaps.length >= 3);
    assert.ok(gaps.every((week) => week.independent === null && week.work === null));
    assert.ok(filled.some((week) => week.work !== null));
    const last = filled.at(-1);
    const series = [last?.independent ?? null, last?.discernment ?? null, last?.assisted ?? null];
    assert.ok(series.every((value) => value !== null));
    assert.deepEqual([...series].sort(), series);
    assert.deepEqual(
      backend.marks.map((mark) => [mark.kind, mark.concept]),
      [
        ["ricochet", "webhook"],
        ["held", "idempotency"],
      ],
    );
  });

  it("draws strata, gaps, the work line and both markers in Svg, the terminal block, the table and Raster cells", () => {
    const svg = svgOf(backend);
    for (const part of ["band band-alone", "band band-proximal", "gap", "work", "mark-ricochet", "mark-held"])
      assert.ok(svg.includes(part), part);
    const blocks = chartLines([backend], { depth: "none", theme: "dark" }).join("\n");
    for (const glyph of ["X", "O", "#", "*", "\\"]) assert.ok(blocks.includes(glyph), glyph);
    const table = tableLines([backend]).join("\n");
    assert.ok(table.includes("X") && table.includes("O") && table.includes("\\"));
    const raster = rasterOf(backend, 72, { theme: "dark" });
    const bytes = decode(raster.cells);
    assert.equal(bytes.length, raster.columns * raster.rows * 12);
    const glyphs = rasterCells(backend, 72, { theme: "dark" }).map((cell) => cell.glyph);
    assert.ok(glyphs.includes("✕") && glyphs.includes("◉") && glyphs.includes("●"));
    assert.equal(bytes[0], (glyphs[0]?.codePointAt(0) ?? 0) & 255);
  });

  it("a domain with too little evidence shows no data", () => {
    const thin = trajectoryOf("security", [event(3, "secret-in-code", "own_change")], [], NOW);
    assert.equal(thin.status, "no_data");
    assert.deepEqual([thin.weeks, thin.marks], [[], []]);
    assert.match(svgOf(thin), /no data \(1 weighted events\)/);
    assert.match(tableLines([thin]).join("\n"), /no data/);
    assert.equal(trajectoryOf("interface", LOG, HELPS, NOW).status, "no_data");
  });

  it("every ricochet marker links to the evidence that produced it", () => {
    const ricochet = backend.marks.find((mark) => mark.kind === "ricochet");
    assert.deepEqual(
      ricochet?.evidence.map((item) => [item.kind, item.task, item.file]),
      [
        ["exposure", "t2", "src/webhook.ts"],
        ["failure_after_approval", "t5", "src/webhook.ts"],
      ],
    );
    const held = backend.marks.find((mark) => mark.kind === "held");
    assert.equal(held?.evidence.at(-1)?.kind, "own_repair");
    assert.match(svgOf(backend), /ricochet · webhook · exposure t2 src\/webhook.ts/);
  });

  it("no chart string addresses the person's ability", () => {
    const texts = [
      ...Object.values(BANDS).map((band) => band.label),
      ...Object.values(GROUP_LABEL),
      ENGLISH_TABLE.legend,
      ENGLISH_TABLE.noData(2),
      ...chartLines([backend], { depth: "none", theme: "dark" }),
      ...svgOf(backend).split(/<[^>]+>/),
    ];
    for (const text of texts) assert.deepEqual(wordingProblems(text), [], text);
  });
});
