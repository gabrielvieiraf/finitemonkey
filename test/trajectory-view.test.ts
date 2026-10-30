import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConceptId } from "../src/conceitos/concepts.js";
import { type ConceptEvent, type ConceptEventKind, type Origin, WEIGHTS } from "../src/conceitos/evidence.js";
import { type HelpMark, trajectoryOf } from "../src/conceitos/trajectory.js";
import { ansi256, chartLines, colorDepth } from "../src/conceitos/trajectory-ansi.js";
import { strataOf } from "../src/conceitos/trajectory-bands.js";
import { svgOf } from "../src/conceitos/trajectory-chart.js";
import { nowOf } from "../src/conceitos/trajectory-now.js";
import { SVG_TOKENS } from "../src/conceitos/trajectory-palette.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { trajectoryLine } from "../src/mod/status.js";
import { cli, fakeRuntime } from "./support.js";

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
  event(28, "idempotency", "check_right"),
  event(27, "idempotency", "check_wrong"),
  event(21, "idempotency", "exposure", "agent", { task: "t4", file: "src/refund.ts" }),
  event(14, "webhook", "failure_after_approval", "person", { task: "t5", file: "src/webhook.ts" }),
  event(7, "idempotency", "failure_after_approval", "person", { task: "t6", file: "src/refund.ts" }),
  event(6, "idempotency", "own_repair", "person", { task: "t6", file: "src/refund.ts" }),
];

const HELPS: readonly HelpMark[] = [
  { at: ago(21), domain: "backend", criterion: "none" },
  { at: ago(21), domain: "backend", criterion: "example" },
];

const backend = trajectoryOf("backend", LOG, HELPS, NOW);

const outline = (svg: string): readonly string[] => {
  const seen: string[] = [];
  for (const match of svg.matchAll(/<(\w+)[^>]*?class="([^"]+)"/g)) {
    const tag = `${match[1] ?? ""}.${(match[2] ?? "")
      .split(" ")
      .filter((name) => !/^[fs]-/.test(name))
      .join(".")}`;
    if (!tag.endsWith(".") && !seen.includes(tag)) seen.push(tag);
  }
  return seen;
};

const duplicateAttributes = (svg: string): readonly string[] =>
  [...svg.matchAll(/<\w+((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g)].flatMap((match) => {
    const names = [...(match[1] ?? "").matchAll(/([\w:-]+)="/g)].map((item) => item[1] ?? "");
    return names.filter((name, index) => names.indexOf(name) !== index);
  });

describe("trajectory view", () => {
  it("records the unstable boundary from right and wrong answers on the same concept", () => {
    const week = backend.weeks.find((item) => item.unstable !== null && item.unstable > 0);
    assert.ok(week !== undefined);
    const strata = strataOf(week, 10).map((stratum) => stratum.band);
    assert.ok(strata.includes("unstable"));
    const ricochet = backend.marks.find((mark) => mark.kind === "ricochet");
    assert.equal(ricochet?.from, backend.weeks.find((item) => item.week === ricochet?.from)?.week);
  });

  it("the Svg keeps the artifact's structure: strata with sub-bands, gaps, grouped key, line and marks", () => {
    const selected = backend.marks[0];
    assert.ok(selected !== undefined);
    const svg = svgOf(backend, { theme: "light", selected });
    assert.deepEqual(outline(svg), [
      "rect.background",
      "rect.plot",
      "rect.gap",
      "path.band.band-alone",
      "path.band.band-proximal",
      "path.band.band-blind",
      "path.band.band-beyond",
      "path.band.band-unstable",
      "path.band-edge",
      "path.band.band-blindCovered",
      "path.band.band-blindBare",
      "line.grid",
      "g.key",
      "g.key-group.key-horizon",
      "path.key-bracket",
      "rect.key-swatch.key-beyond",
      "rect.key-hypothesis",
      "g.key-group.key-blind",
      "rect.key-swatch.key-blindCovered",
      "rect.key-swatch.key-blindBare",
      "rect.key-swatch.key-blind",
      "g.key-group.key-discernment",
      "rect.key-swatch.key-unstable",
      "g.key-group.key-proximal",
      "rect.key-swatch.key-proximal",
      "g.key-group.key-alone",
      "rect.key-swatch.key-alone",
      "circle.point",
      "path.work",
      "path.ricochet-arc",
      "line.rebuild",
      "g.mark-ricochet",
      "circle.selected",
      "g.mark-held",
    ]);
    assert.equal(svg.match(/hypothesis, not drawn/g)?.length, 3);
    for (const label of ["transfer vs known context", "explains vs detects only", "recognizable vs out of reach"])
      assert.ok(svg.includes(label), label);
    assert.match(svg, /unstable boundary · calibration/);
    assert.deepEqual(duplicateAttributes(svg), []);
  });

  it("light and dark draw with their own tokens, and auto follows the viewer's color scheme", () => {
    const light = svgOf(backend, { theme: "light" });
    const dark = svgOf(backend, { theme: "dark" });
    const auto = svgOf(backend);
    assert.ok(light.includes(`fill="${SVG_TOKENS.light.bg}"`) && !light.includes(SVG_TOKENS.dark.bg));
    assert.ok(dark.includes(`fill="${SVG_TOKENS.dark.bg}"`) && !dark.includes(SVG_TOKENS.light.bg));
    assert.ok(!light.includes("<style>") && !dark.includes("<style>"));
    assert.match(auto, /<style>@media \(prefers-color-scheme: dark\)\{.*\.f-bg\{fill:#0d1014\}/);
    for (const svg of [light, dark, auto]) assert.ok(!svg.includes("currentColor") && svg.length < 131_072);
    assert.match(dark, /data-theme="dark"/);
  });

  it("the terminal block is plain ASCII with a legend without color, and colored cells with it", () => {
    const plain = chartLines([backend], { depth: "none", theme: "dark" }).join("\n");
    assert.ok(/^[\x20-\x7e\n]*$/.test(plain), plain);
    assert.ok(!plain.includes("\u001b"));
    assert.match(plain, /# does alone {2}= proximal band {2}~ unstable \(calibration\)/);
    assert.match(plain, /\* work landed {2}X ricochet {2}O held/);
    assert.match(plain, /not drawn \(hypothesis\)/);
    const indexed = chartLines([backend], { depth: "256", theme: "dark" }).join("\n");
    assert.ok(indexed.includes("\u001b[48;5;22m"));
    assert.ok(indexed.includes("\u001b[1;38;5;210m✕"));
    const truecolor = chartLines([backend], { depth: "truecolor", theme: "light" }).join("\n");
    assert.ok(truecolor.includes("\u001b[48;2;207;231;218m"));
    assert.equal(ansi256(0x5a2420), 52);
  });

  it("color depth follows NO_COLOR, the TTY and COLORTERM", () => {
    assert.equal(colorDepth({ NO_COLOR: "1", COLORTERM: "truecolor" }, true), "none");
    assert.equal(colorDepth({}, false), "none");
    assert.equal(colorDepth({ FORCE_COLOR: "1" }, false), "256");
    assert.equal(colorDepth({ TERM: "dumb" }, true), "none");
    assert.equal(colorDepth({ COLORTERM: "truecolor" }, true), "truecolor");
    assert.equal(colorDepth({ TERM: "xterm-256color" }, true), "256");
  });

  it("the line above the prompt names the domain, the band the work landed in and the last ricochet", () => {
    const now = nowOf([backend]);
    assert.ok(now !== null);
    assert.equal(now.domain, "backend");
    assert.equal(now.ricochet?.concept, "webhook");
    const line = trajectoryLine({ domain: "backend", band: now.band, ricochet: now.ricochet });
    assert.match(line, /^trajectory backend: .+, last ricochet webhook W\d\d$/);
    assert.equal(nowOf([trajectoryOf("security", [], [], NOW)]), null);
  });

  it("finitemonkey trajectory prints the block without color when stdout is not a terminal", async () => {
    const root = "/home/ana/project";
    const runtime = fakeRuntime({
      now: new Date(NOW).toISOString(),
      files: {
        [`${root}/.finitemonkey/conceitos-events.jsonl`]: LOG.map((item) => JSON.stringify(item)).join("\n"),
      },
    });
    const plain = await cli(["trajectory", "--domain", "backend"], { runtime, cwd: toAbsolutePath(root) });
    assert.equal(plain.code, 0, plain.stderr);
    assert.match(plain.stdout, /^backend, 2026-W\d\d to 2026-W\d\d, \d+ weighted events/m);
    assert.ok(!plain.stdout.includes("\u001b"));
    const forced = await cli(["trajectory", "--domain", "backend"], {
      runtime,
      cwd: toAbsolutePath(root),
      env: { FORCE_COLOR: "1" },
    });
    assert.ok(forced.stdout.includes("\u001b[48;5;"));
    const table = await cli(["trajectory", "--table"], { runtime, cwd: toAbsolutePath(root) });
    assert.match(table.stdout, /^backend +.*X/m);
  });
});
