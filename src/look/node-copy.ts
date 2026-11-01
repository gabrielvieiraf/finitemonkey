import { isRecord } from "../core/parsed.js";
import {
  RENDERED_LIMIT,
  type RenderedCopy,
  renderedCopy,
  renderedCopyIssues,
  type RenderedText,
} from "./copy-rendered.js";
import { type CatalogEntry, UI_COPY_FEATURE } from "./copy-rules.js";
import type { PagePass } from "./node-ux.js";
import { runInPage } from "./probe-dom.js";

const KINDS = ["button", "link", "error"] as const;

const COPY_SCRIPT = runInPage(renderedCopy.toString(), ["document", "window", String(RENDERED_LIMIT)]);

export const parseRendered = (raw: unknown): RenderedCopy => {
  if (!isRecord(raw)) return { lang: "", items: [] };
  const items = Array.isArray(raw["items"])
    ? raw["items"].flatMap((item: unknown): RenderedText[] => {
        if (!isRecord(item) || typeof item["sel"] !== "string" || typeof item["text"] !== "string") return [];
        const kind = KINDS.find((name) => name === item["kind"]);
        return kind === undefined ? [] : [{ sel: item["sel"], kind, text: item["text"] }];
      })
    : [];
  return { lang: typeof raw["lang"] === "string" ? raw["lang"] : "", items };
};

export interface CopyPassOptions {
  readonly entries: readonly CatalogEntry[];
  readonly allow: readonly string[];
  readonly widest: number;
}

export const copyPass = (options: CopyPassOptions): PagePass => ({
  feature: UI_COPY_FEATURE,
  allWidths: false,
  run: async (page, at) => {
    if (at.viewport !== options.widest) return [];
    return renderedCopyIssues(parseRendered(await page.evaluate(COPY_SCRIPT)), options.entries, options.allow);
  },
});
