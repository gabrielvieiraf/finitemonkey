import { type CatalogEntry, type CopyLang, hasAction, langOf, startsWithVerb } from "./copy-rules.js";
import type { Kit, MiniDoc, MiniEl, MiniWin } from "./probe-dom.js";
import type { LookRule } from "./types.js";
import { issue, type UxIssue } from "./ux.js";

export const RENDERED_LIMIT = 200;

export type RenderedKind = "button" | "link" | "error";

export interface RenderedText {
  readonly sel: string;
  readonly kind: RenderedKind;
  readonly text: string;
}

export interface RenderedCopy {
  readonly lang: string;
  readonly items: readonly RenderedText[];
}

export const renderedCopy = (kit: Kit, doc: MiniDoc, win: MiniWin, limit: number): RenderedCopy => {
  const shown = (element: MiniEl): boolean => {
    const rect = element.getBoundingClientRect();
    const style = win.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.getPropertyValue("visibility") !== "hidden" &&
      element.closest("[aria-hidden=true]") === null
    );
  };
  const named = (element: MiniEl): string => kit.nameOf(kit, doc, element, element.tagName.toLowerCase());
  const errorIds = [...doc.querySelectorAll("[aria-invalid=true]")].flatMap((field) =>
    `${kit.clean(field.getAttribute("aria-errormessage"))} ${kit.clean(field.getAttribute("aria-describedby"))}`
      .split(" ")
      .filter((id) => id !== ""),
  );
  const errors = [...doc.querySelectorAll("[role=alert]"), ...errorIds.flatMap((id) => doc.getElementById(id) ?? [])];
  const groups: readonly (readonly [RenderedKind, readonly MiniEl[], (element: MiniEl) => string])[] = [
    ["button", [...doc.querySelectorAll("button, [role=button], input[type=submit], input[type=button]")], named],
    ["link", [...doc.querySelectorAll("a[href]")], named],
    ["error", errors, (element) => kit.clean(element.textContent)],
  ];
  const seen = new Set<MiniEl>();
  const items: RenderedText[] = [];
  for (const [kind, elements, textOf] of groups)
    for (const element of elements) {
      if (items.length >= limit || seen.has(element) || !shown(element)) continue;
      seen.add(element);
      items.push({ sel: kit.selectorOf(element), kind, text: textOf(element) });
    }
  return { lang: kit.clean(doc.documentElement.getAttribute("lang")), items };
};

export const copyLangOf = (tag: string): CopyLang | undefined => (tag === "" ? undefined : langOf(tag));

const ruleFor = (item: RenderedText, lang: CopyLang | undefined): LookRule | undefined => {
  const text = item.text.trim();
  if (item.kind === "error")
    return text === "" || lang === undefined || hasAction(text, lang) ? undefined : "ui-copy/error-action";
  if (text === "") return "ui-copy/empty-label";
  if (item.kind === "link" || lang === undefined) return undefined;
  return startsWithVerb(text, lang) ? undefined : "ui-copy/verb-first";
};

const DETAILS: Readonly<Record<string, string>> = {
  "ui-copy/error-action": "rendered error does not say what to do next",
  "ui-copy/empty-label": "rendered control has no visible label or name",
  "ui-copy/verb-first": "rendered button label does not start with a verb",
};

const keyOf = (text: string, lang: CopyLang | undefined, entries: readonly CatalogEntry[]): string | undefined => {
  const wanted = text.trim();
  const match = entries.find(
    (entry) => entry.text.trim() === wanted && (lang === undefined || entry.lang === undefined || entry.lang === lang),
  );
  return match === undefined ? undefined : `${match.file}#${match.key}`;
};

export const renderedCopyIssues = (
  copy: RenderedCopy,
  entries: readonly CatalogEntry[],
  allow: readonly string[],
): readonly UxIssue[] => {
  const lang = copyLangOf(copy.lang);
  const allowed = new Set(allow.map((item) => item.trim().toLowerCase()));
  return copy.items.flatMap((item) => {
    const rule = ruleFor(item, lang);
    if (rule === undefined || allowed.has(item.text.trim().toLowerCase())) return [];
    const key = item.text.trim() === "" ? undefined : keyOf(item.text, lang, entries);
    if (key !== undefined && allowed.has(key.split("#")[1]?.toLowerCase() ?? "")) return [];
    const where = key === undefined ? "" : ` (catalog ${key})`;
    return [issue(rule, item.sel, `${DETAILS[rule] ?? ""}: "${item.text.slice(0, 60)}"${where}`, { advisory: true })];
  });
};
