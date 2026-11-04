import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { ConceptId } from "../src/conceitos/concepts.js";
import { type ConceptEvent, type ConceptEventKind, WEIGHTS } from "../src/conceitos/evidence.js";
import { trajectoryOf, weekKeys } from "../src/conceitos/trajectory.js";
import { chartLines } from "../src/conceitos/trajectory-ansi.js";
import { rasterCells, rasterOf, rasterShape, svgOf } from "../src/conceitos/trajectory-chart.js";
import { withResearch } from "../src/conceitos/trajectory-research.js";
import { researchMarks } from "../src/conceitos/trajectory-research-read.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { parseEntry } from "../src/judge/parse.js";
import type { JudgeEntry } from "../src/judge/types.js";
import { parseTrajectories } from "../src/mod/trajectory-parse.js";
import { cli, cliJson, fakeRuntime, field } from "./support.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-29T12:00:00Z");
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const event = (days: number, concept: ConceptId, kind: ConceptEventKind, origin = "person" as const): ConceptEvent => ({
  at: ago(days),
  concept,
  kind,
  origin,
  weight: WEIGHTS[kind],
});

const LOG: readonly ConceptEvent[] = [
  event(70, "api", "own_change"),
  event(63, "api", "prediction_right"),
  event(63, "migration", "prediction_right"),
  event(49, "migration", "own_change"),
  event(28, "idempotency", "check_right"),
  event(21, "webhook", "own_change"),
  event(14, "webhook", "prediction_right"),
];

const RECORDS: readonly Readonly<Record<string, unknown>>[] = [
  { type: "concept", id: "c-retry", at: ago(40), domain: "backend", label: "retry", origin: "span", anchors: [] },
  { type: "concept", id: "c-vat", at: ago(40), domain: "tax-law", label: "VAT", origin: "span", anchors: [] },
  ...[
    ["v-revert", 20, "c-retry"],
    ["v-person", 13, "c-retry"],
    ["v-open", 6, "c-vat"],
  ].map(([id, days, concept]) => ({
    type: "event",
    id,
    at: ago(Number(days)),
    claim: `claim-${String(id)}`,
    cause: "failed-in-use",
    state: "open",
    support: "machine-verified",
    bands: { [String(concept)]: "proximal" },
    sources: [],
  })),
  {
    type: "event",
    id: "v-revert",
    at: ago(19),
    claim: "claim-v-revert",
    cause: "failed-in-use",
    state: "open",
    support: "machine-verified",
    bands: { "c-retry": "proximal" },
    sources: [],
    fixedBy: "revert",
    fixedCommit: "abc1234",
  },
  {
    type: "event",
    id: "v-person",
    at: ago(12),
    claim: "claim-v-person",
    cause: "failed-in-use",
    state: "held",
    support: "machine-verified",
    bands: { "c-retry": "proximal" },
    sources: [],
    fixedBy: "person",
  },
];

const ENTRIES: readonly JudgeEntry[] = RECORDS.flatMap((record) => parseEntry(record as never) ?? []);

const drawn = withResearch([trajectoryOf("backend", LOG, [], NOW)], researchMarks(ENTRIES), weekKeys(NOW));
const backend = drawn.domains[0] ?? assert.fail("no backend trajectory");

describe("research events beside code events", () => {
  it("reads who fixed each research ricochet and keeps the field of its concepts", () => {
    const marks = researchMarks(ENTRIES);
    assert.deepEqual(
      marks.map((mark) => [mark.event, mark.fix, mark.field, mark.commit]),
      [
        ["v-revert", "revert", "backend", "abc1234"],
        ["v-person", "person", "backend", null],
        ["v-open", "open", "tax-law", null],
      ],
    );
    assert.equal(marks[0]?.at, ago(20));
    assert.deepEqual(
      drawn.outside.map((mark) => mark.event),
      ["v-open"],
    );
  });

  it("draws research and code events together in the terminal with a different mark for revert and person", () => {
    assert.equal(backend.status, "ok");
    const plain = chartLines([backend], { depth: "none", theme: "dark" });
    const lane = plain.find((line) => line.endsWith(" research")) ?? "";
    assert.match(lane, /R/);
    assert.match(lane, /P/);
    assert.ok(lane.indexOf("R") < lane.indexOf("P"));
    assert.ok(plain.some((line) => line.includes("R fixed by revert") && line.includes("P fixed by the person")));
    const color = chartLines([backend], { depth: "256", theme: "dark" }).join("\n");
    assert.ok(color.includes("↺") && color.includes("◆"));
  });

  it("draws research marks in the Svg next to the ricochet marks, one shape per fix", () => {
    const svg = svgOf(backend, { theme: "light" });
    assert.equal((svg.match(/class="research-revert"/g) ?? []).length, 1);
    assert.equal((svg.match(/class="research-person"/g) ?? []).length, 1);
    assert.match(svg, /fixed by revert in abc1234/);
    assert.ok(!svg.includes("research-open"));
  });

  it("the mod's raster draws the research lane with a different glyph and ink for revert and person", () => {
    const shape = rasterShape(backend, 72);
    const cells = rasterCells(backend, 72, { theme: "dark" });
    assert.equal(cells.length, shape.columns * shape.rows);
    const rows = Array.from({ length: shape.rows }, (_, row) =>
      cells.slice(row * shape.columns, (row + 1) * shape.columns),
    );
    const lane =
      rows.find((row) =>
        row
          .map((cell) => cell.glyph)
          .join("")
          .trimEnd()
          .endsWith("research"),
      ) ?? [];
    const revert = lane.find((cell) => cell.glyph === "↺");
    const person = lane.find((cell) => cell.glyph === "◆");
    assert.ok(revert !== undefined && person !== undefined);
    assert.notEqual(revert.fg, person.fg);
    const plain = trajectoryOf("backend", LOG, [], NOW);
    assert.equal(rasterShape(plain, 72).rows, shape.rows - 1);
    assert.equal(rasterOf(backend, 72, { theme: "dark" }).rows, shape.rows);
  });

  it("the mod reads the research marks back from the JSON", () => {
    const parsed = parseTrajectories(JSON.stringify({ schema: "finitemonkey/trajectory@1", domains: [backend] }));
    assert.deepEqual(parsed[0]?.research, backend.research);
  });

  it("finitemonkey trajectory reads judge.jsonl next to the code events", async () => {
    const root = toAbsolutePath("/home/ana/project");
    const runtime = fakeRuntime({
      now: new Date(NOW).toISOString(),
      files: {
        [join(root, ".finitemonkey", "conceitos-events.jsonl")]: LOG.map((item) => JSON.stringify(item)).join("\n"),
        [join(root, ".finitemonkey", "judge.jsonl")]: RECORDS.map((item) =>
          JSON.stringify({ schema: "finitemonkey/judge@1", ...item }),
        ).join("\n"),
      },
    });
    const plain = await cli(["trajectory"], { runtime, cwd: root });
    assert.equal(plain.code, 0, plain.stderr);
    assert.match(plain.stdout, /R +P +research/);
    assert.match(plain.stdout, /research tax-law 2026-W\d\d: claim-v-open, research ricochet, open/);
    const json = await cliJson(["trajectory"], { runtime, cwd: root });
    const domains = field(json.body, "data", "domains");
    const found: unknown = Array.isArray(domains)
      ? domains.find((item) => field(item, "domain") === "backend")
      : undefined;
    const research = field(found, "research");
    assert.equal(Array.isArray(research) ? research.length : 0, 2);
  });
});
