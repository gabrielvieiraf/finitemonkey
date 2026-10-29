import type { FieldInfo, FieldState } from "./forms-dom.js";
import { issue, type UxIssue } from "./ux.js";

export const FORMS_FEATURE = "ui-forms";
export const SETTLE_MS = 300;

const VALID: Readonly<Record<string, string>> = {
  email: "ana@example.com",
  url: "https://example.com",
  tel: "5551234567",
  date: "2026-01-15",
  password: "Correct-horse-9",
  search: "orders",
};

export const validValue = (field: FieldInfo, declared: Readonly<Record<string, string>>): string | undefined => {
  const given = declared[field.sel];
  if (given !== undefined) return given;
  if (field.pattern !== "") return undefined;
  if (field.type === "number") return field.min !== "" ? field.min : "1";
  const base = VALID[field.type] ?? "Valid input";
  return base.length >= field.minLength ? base : base.padEnd(field.minLength, "x");
};

export const invalidValue = (field: FieldInfo): string | undefined => {
  if (field.type === "email") return "not-an-email";
  if (field.type === "url") return "not a url";
  if (field.type === "number" && field.min !== "") return String(Number(field.min) - 1);
  if (field.pattern !== "") return "!!!";
  if (field.minLength > 1) return "a";
  return field.required ? "" : undefined;
};

export const placeholderIssues = (fields: readonly FieldInfo[]): readonly UxIssue[] =>
  fields
    .filter((field) => !field.labelled && field.placeholder !== "")
    .map((field) =>
      issue("forms/placeholder-label", field.sel, `placeholder "${field.placeholder}" is the only label`),
    );

export const prematureIssues = (field: FieldInfo, typing: FieldState): readonly UxIssue[] =>
  typing.invalid || typing.message !== ""
    ? [issue("forms/premature", field.sel, "an error shows on the first keystroke, before the field is left")]
    : [];

export interface Submitted {
  readonly target: FieldInfo;
  readonly typed: Readonly<Record<string, string>>;
  readonly after: readonly FieldState[];
  readonly corrected: FieldState | undefined;
  readonly keepCleared: readonly string[];
  readonly native: boolean;
}

const lost = (result: Submitted): readonly UxIssue[] =>
  result.after.flatMap((state) => {
    const typed = result.typed[state.sel];
    if (typed === undefined || result.keepCleared.includes(state.sel)) return [];
    return state.exists && state.value === typed
      ? []
      : [issue("forms/input-lost", state.sel, `typed "${typed}" is gone after the failed submit`)];
  });

export const submitIssues = (result: Submitted): readonly UxIssue[] => {
  if (result.native)
    return [
      issue("forms/native", result.target.sel, "the browser blocked the submit; the error is the native bubble", {
        unverified: true,
      }),
      ...lost(result),
    ];
  const target = result.after.find((state) => state.sel === result.target.sel);
  const linked = target !== undefined && target.message !== "" && target.near;
  return [
    ...(linked
      ? []
      : [
          issue(
            "forms/error-not-linked",
            result.target.sel,
            "no error next to the field and linked by aria-describedby or aria-errormessage",
          ),
        ]),
    ...(target?.focused === true
      ? []
      : [issue("forms/focus-not-moved", result.target.sel, "focus did not move to the first field with an error")]),
    ...lost(result),
    ...(linked && result.corrected !== undefined && (result.corrected.invalid || result.corrected.message !== "")
      ? [issue("forms/error-sticks", result.target.sel, "the error stays after the field is corrected")]
      : []),
  ];
};
