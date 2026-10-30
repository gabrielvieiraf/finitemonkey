import type { Page } from "playwright-core";

import { isRecord } from "../core/parsed.js";
import {
  FORMS_FEATURE,
  invalidValue,
  placeholderIssues,
  prematureIssues,
  SETTLE_MS,
  submitIssues,
  type Submitted,
  validValue,
} from "./forms.js";
import { type FieldInfo, type FieldState, fieldStates, formFields } from "./forms-dom.js";
import type { PagePass } from "./node-ux.js";
import { runInPage } from "./probe-dom.js";
import { issue, type UxIssue } from "./ux.js";

export interface FormsOptions {
  readonly forms: Readonly<Record<string, readonly string[]>>;
  readonly keepCleared: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly widest: number;
}

const text = (value: unknown, key: string): string =>
  isRecord(value) && typeof value[key] === "string" ? value[key] : "";

const fieldsOf = async (page: Page, form: string): Promise<readonly FieldInfo[]> => {
  const raw: unknown = await page.evaluate(runInPage(formFields.toString(), ["document", JSON.stringify(form)]));
  return Array.isArray(raw)
    ? raw.flatMap((item: unknown) =>
        isRecord(item) && typeof item["sel"] === "string"
          ? [
              {
                sel: item["sel"],
                type: text(item, "type"),
                required: item["required"] === true,
                pattern: text(item, "pattern"),
                min: text(item, "min"),
                max: text(item, "max"),
                minLength: typeof item["minLength"] === "number" ? item["minLength"] : 0,
                labelled: item["labelled"] === true,
                placeholder: text(item, "placeholder"),
              },
            ]
          : [],
      )
    : [];
};

const statesOf = async (page: Page, selectors: readonly string[]): Promise<readonly FieldState[]> => {
  const raw: unknown = await page.evaluate(
    runInPage(fieldStates.toString(), ["document", "window", JSON.stringify(selectors)]),
  );
  return Array.isArray(raw)
    ? raw.flatMap((item: unknown) =>
        isRecord(item) && typeof item["sel"] === "string"
          ? [
              {
                sel: item["sel"],
                value: text(item, "value"),
                invalid: item["invalid"] === true,
                message: text(item, "message"),
                near: item["near"] === true,
                focused: item["focused"] === true,
                exists: item["exists"] === true,
              },
            ]
          : [],
      )
    : [];
};

const premature = async (page: Page, field: FieldInfo, valid: string): Promise<readonly UxIssue[]> => {
  await page.locator(field.sel).first().focus();
  await page.keyboard.type(valid.slice(0, 1));
  await page.waitForTimeout(SETTLE_MS);
  const [state] = await statesOf(page, [field.sel]);
  await page.locator(field.sel).first().fill("");
  return state === undefined ? [] : prematureIssues(field, state);
};

const submit = async (page: Page, form: string, target: FieldInfo): Promise<boolean> => {
  const blocked = await page.evaluate(
    `(() => { const form = document.querySelector(${JSON.stringify(form)}); const field = document.querySelector(${JSON.stringify(target.sel)}); return !!form && !form.noValidate && !!field && !field.checkValidity(); })()`,
  );
  const button = page
    .locator(`${form} button:not([type=button]):not([type=reset]), ${form} input[type=submit]`)
    .first();
  if ((await button.count()) > 0) await button.click({ timeout: 2000 }).catch(() => undefined);
  else await page.locator(target.sel).first().press("Enter");
  await page.waitForTimeout(SETTLE_MS);
  return blocked === true;
};

const fill = async (
  page: Page,
  fields: readonly FieldInfo[],
  target: FieldInfo,
  values: Readonly<Record<string, string>>,
) => {
  const typed: Record<string, string> = {};
  for (const field of fields) {
    const value = field === target ? invalidValue(field) : validValue(field, values);
    if (value === undefined) continue;
    await page.locator(field.sel).first().fill(value);
    typed[field.sel] = value;
  }
  return typed;
};

const checkForm = async (page: Page, url: string, form: string, options: FormsOptions): Promise<readonly UxIssue[]> => {
  await page.goto(url, { waitUntil: "networkidle" });
  const fields = await fieldsOf(page, form);
  if (fields.length === 0) return [issue("forms/native", form, "form not found on the page", { unverified: true })];
  const target = fields.find(
    (field) => invalidValue(field) !== undefined && validValue(field, options.values) !== undefined,
  );
  if (target === undefined) return placeholderIssues(fields);
  const valid = validValue(target, options.values) ?? "";
  const early = target.type === "number" ? [] : await premature(page, target, valid);
  const typed = await fill(page, fields, target, options.values);
  const native = await submit(page, form, target);
  const after = await statesOf(page, Object.keys(typed));
  await page
    .locator(target.sel)
    .first()
    .fill(valid)
    .catch(() => undefined);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(SETTLE_MS);
  const [corrected] = await statesOf(page, [target.sel]);
  const result: Submitted = { target, typed, after, corrected, keepCleared: options.keepCleared, native };
  return [...placeholderIssues(fields), ...early, ...submitIssues(result)];
};

export const formsPass = (options: FormsOptions): PagePass => ({
  feature: FORMS_FEATURE,
  allWidths: false,
  run: async (page, at) => {
    const forms = options.forms[at.route] ?? [];
    if (at.viewport !== options.widest || forms.length === 0) return [];
    const found: UxIssue[] = [];
    for (const form of forms) {
      try {
        found.push(...(await checkForm(page, at.url, form, options)));
      } catch (error) {
        const detail = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
        found.push(issue("forms/native", form, `form could not be exercised: ${detail}`, { unverified: true }));
      }
    }
    await page.goto(at.url, { waitUntil: "networkidle" }).catch(() => undefined);
    return found;
  },
});
