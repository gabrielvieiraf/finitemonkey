import { toAbsolutePath } from "../../core/brand.js";
import type { Runtime } from "../../core/runtime.js";
import type { Note } from "../../evidence/types.js";
import { changedMarkdown } from "../../prose/gate.js";
import { citedQuotes, quoteIn, resolveCited } from "../../quotes/spans.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 10;
const SHOWN = 60;

const shorten = (span: string): string => {
  const flat = span.replace(/\s+/g, " ").trim();
  return flat.length > SHOWN ? `${flat.slice(0, SHOWN - 1)}…` : flat;
};

const sourceOf = (runtime: Runtime, root: GateContext["paths"]["root"], file: string, cited: string) => {
  for (const path of resolveCited(file, cited)) {
    const text = runtime.readText(toAbsolutePath(path, root));
    if (text.ok) return { path, text: text.value };
  }
  return undefined;
};

const problemsIn = (ctx: GateContext, file: string): { readonly checked: number; readonly notes: readonly Note[] } => {
  const text = ctx.runtime.readText(toAbsolutePath(file, ctx.paths.root));
  if (!text.ok) return { checked: 0, notes: [] };
  const notes: Note[] = [];
  let checked = 0;
  for (const quote of citedQuotes(text.value)) {
    const source = sourceOf(ctx.runtime, ctx.paths.root, file, quote.cited);
    if (source === undefined) continue;
    checked += 1;
    if (!quoteIn(quote.span, source.text)) {
      notes.push(
        note("gate.quotes.missing", {
          at: `${file}:${String(quote.line)}`,
          quote: shorten(quote.span),
          source: source.path,
        }),
      );
    }
  }
  return { checked, notes };
};

export const quotesCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const files = changedMarkdown(ctx.runtime, ctx.paths.root);
  if (!files.ok) return unverified("tool_missing", [note("gate.quotes.unavailable")]);
  const results = files.value.map((file) => problemsIn(ctx, file));
  const checked = results.reduce((sum, result) => sum + result.checked, 0);
  const notes = results.flatMap((result) => result.notes);
  if (notes.length === 0) return passed([note("gate.quotes.ok", { count: checked })]);
  return failed(notes.slice(0, MAX_LISTED));
};
