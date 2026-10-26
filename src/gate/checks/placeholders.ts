import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { isTestFile } from "../../guards/tests/patterns.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type AddedLine, addedLines } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;
const SKIP_FILES = /\.(md|mdx|txt|rst|lock|snap|svg|png|jpg|gif|json)$|(^|\/)(CHANGELOG|LICENSE)/i;
export const PLACEHOLDER =
  /\b(TODO|FIXME|XXX)\b|not implemented|NotImplementedError|unimplemented!|todo!\(|lorem ipsum/i;

export const findPlaceholders = (lines: readonly AddedLine[]): readonly AddedLine[] =>
  lines.filter((line) => !isTestFile(line.path) && !SKIP_FILES.test(line.path) && PLACEHOLDER.test(line.text));

const untrackedAdded = (ctx: GateContext): readonly AddedLine[] =>
  ctx.changes
    .filter((change) => change.status === "A" && !SKIP_FILES.test(change.path))
    .flatMap((change) => {
      const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, change.path)));
      return text.ok
        ? text.value.split("\n").map((line, index) => ({ path: change.path, line: index + 1, text: line }))
        : [];
    });

export const placeholdersCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const tracked = addedLines(ctx.git, ctx.base);
  const seen = new Set(tracked.map((line) => line.path));
  const found = findPlaceholders([...tracked, ...untrackedAdded(ctx).filter((line) => !seen.has(line.path))]);
  if (found.length === 0) return passed([note("gate.placeholders.clean")]);
  return failed(
    found.slice(0, MAX_LISTED).map((line) => note("gate.placeholders.found", { file: line.path, line: line.line })),
  );
};
