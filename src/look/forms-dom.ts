import type { Kit, MiniDoc, MiniEl, MiniWin } from "./probe-dom.js";

export interface FieldInfo {
  readonly sel: string;
  readonly type: string;
  readonly required: boolean;
  readonly pattern: string;
  readonly min: string;
  readonly max: string;
  readonly minLength: number;
  readonly labelled: boolean;
  readonly placeholder: string;
}

export interface FieldState {
  readonly sel: string;
  readonly value: string;
  readonly invalid: boolean;
  readonly message: string;
  readonly near: boolean;
  readonly focused: boolean;
  readonly exists: boolean;
}

interface FieldEl extends MiniEl {
  readonly value: string;
}

export interface FormDoc extends MiniDoc {
  readonly activeElement: MiniEl | null;
  readonly querySelector: (selector: string) => FieldEl | null;
}

export const formFields = (kit: Kit, doc: MiniDoc, form: string): readonly FieldInfo[] => {
  const root = [...doc.querySelectorAll(form)][0];
  if (root === undefined) return [];
  const skip = ["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file"];
  return [...root.querySelectorAll("input, textarea")].flatMap((field) => {
    const type = kit.clean(field.getAttribute("type")).toLowerCase() || "text";
    if (skip.includes(type) || field.hasAttribute("disabled")) return [];
    const attr = (name: string): string => kit.clean(field.getAttribute(name));
    return [
      {
        sel: kit.selectorOf(field),
        type,
        required: field.hasAttribute("required"),
        pattern: attr("pattern"),
        min: attr("min"),
        max: attr("max"),
        minLength: Number.parseInt(attr("minlength"), 10) || 0,
        labelled: kit.labelText(kit, doc, field) !== "" || attr("title") !== "",
        placeholder: attr("placeholder"),
      },
    ];
  });
};

export const fieldStates = (
  kit: Kit,
  doc: FormDoc,
  _win: MiniWin,
  selectors: readonly string[],
): readonly FieldState[] =>
  selectors.map((sel) => {
    const field = doc.querySelector(sel);
    if (field === null)
      return { sel, value: "", invalid: false, message: "", near: false, focused: false, exists: false };
    const ids =
      `${kit.clean(field.getAttribute("aria-describedby"))} ${kit.clean(field.getAttribute("aria-errormessage"))}`
        .split(" ")
        .filter((id) => id !== "");
    const box = field.getBoundingClientRect();
    const shown = ids.flatMap((id) => {
      const target = doc.getElementById(id);
      if (target === null) return [];
      const rect = target.getBoundingClientRect();
      const text = kit.clean(target.textContent);
      return rect.width > 0 && rect.height > 0 && text !== ""
        ? [{ text, gap: Math.abs(rect.y - (box.y + box.height)) }]
        : [];
    });
    return {
      sel,
      value: field.value,
      invalid: field.getAttribute("aria-invalid") === "true",
      message: shown.map((item) => item.text).join(" "),
      near: shown.some((item) => item.gap <= 150),
      focused: doc.activeElement === field,
      exists: true,
    };
  });
