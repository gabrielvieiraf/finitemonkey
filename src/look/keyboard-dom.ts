import type { Kit, MiniDoc, MiniEl, MiniWin } from "./probe-dom.js";

export interface FocusStop {
  readonly sel: string;
  readonly role: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly obscured: boolean;
  readonly composite: string | null;
  readonly modal: boolean;
}

export interface FocusTarget {
  readonly sel: string;
  readonly composite: string | null;
}

interface Containing extends MiniEl {
  readonly contains: (other: MiniEl) => boolean;
}

export interface FocusDoc extends MiniDoc {
  readonly activeElement: Containing | null;
  readonly elementFromPoint: (x: number, y: number) => Containing | null;
}

export const COMPOSITES =
  "[role=tablist], [role=menu], [role=menubar], [role=radiogroup], [role=listbox], [role=grid], [role=toolbar], [role=tree]";
export const MODALS = "dialog[open], [role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]";

export const focusNow = (
  kit: Kit,
  doc: FocusDoc,
  win: MiniWin,
  composites: string,
  modals: string,
): FocusStop | null => {
  const element = doc.activeElement;
  if (element === null || element === doc.body || element === doc.documentElement) return null;
  const rect = element.getBoundingClientRect();
  const hit = doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  let cover: MiniEl | null =
    hit !== null && hit !== element && !element.contains(hit) && !hit.contains(element) ? hit : null;
  let obscured = false;
  while (cover !== null && !obscured) {
    const position = win.getComputedStyle(cover).getPropertyValue("position");
    obscured = position === "fixed" || position === "sticky";
    cover = cover.parentElement;
  }
  const composite = element.closest(composites);
  return {
    sel: kit.selectorOf(element),
    role: kit.roleOf(kit, element, element.tagName.toLowerCase()),
    name: kit.nameOf(kit, doc, element, element.tagName.toLowerCase()),
    x: rect.x + win.scrollX,
    y: rect.y + win.scrollY,
    w: rect.width,
    h: rect.height,
    obscured,
    composite: composite === null ? null : kit.selectorOf(composite),
    modal: element.closest(modals) !== null,
  };
};

export const focusTargets = (kit: Kit, doc: MiniDoc, win: MiniWin, composites: string): readonly FocusTarget[] => {
  const query =
    "a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=switch], [tabindex]";
  return [...doc.querySelectorAll(query)].flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const style = win.getComputedStyle(element);
    const tag = element.tagName.toLowerCase();
    const shown = rect.width > 0 && rect.height > 0 && style.getPropertyValue("visibility") !== "hidden";
    const hidden =
      (tag === "input" && element.getAttribute("type") === "hidden") ||
      element.closest("[aria-hidden=true], [inert]") !== null;
    const role = kit.roleOf(kit, element, tag);
    const decorative =
      element.hasAttribute("tabindex") &&
      !["a", "button", "input", "select", "textarea", "summary"].includes(tag) &&
      role === "";
    if (!shown || hidden || element.hasAttribute("disabled") || decorative) return [];
    const composite = element.closest(composites);
    return [{ sel: kit.selectorOf(element), composite: composite === null ? null : kit.selectorOf(composite) }];
  });
};
