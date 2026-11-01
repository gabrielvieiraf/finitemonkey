import { validValue } from "./forms.js";
import type { StepEntry } from "./forms-dom.js";
import { issue, type UxIssue } from "./ux.js";

export const REDUNDANT_RULE = "forms/redundant-entry";
const GENERIC_AUTOCOMPLETE = new Set(["", "on", "off"]);
const UNIQUE_TYPES = new Set(["email", "tel", "url"]);

export interface StepSnapshot {
  readonly fields: readonly StepEntry[];
  readonly choices: readonly string[];
}

export interface StepDriver {
  readonly snapshot: (step: string) => Promise<StepSnapshot | undefined>;
  readonly fill: (sel: string, value: string) => Promise<void>;
  readonly submit: (step: string) => Promise<void>;
}

export interface Typed {
  readonly entry: StepEntry;
  readonly value: string;
  readonly step: number;
}

const words = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const sameInformation = (earlier: StepEntry, later: StepEntry): boolean =>
  (!GENERIC_AUTOCOMPLETE.has(earlier.autocomplete) && earlier.autocomplete === later.autocomplete) ||
  (UNIQUE_TYPES.has(earlier.type) && earlier.type === later.type) ||
  (earlier.name !== "" && earlier.name === later.name) ||
  (words(earlier.label) !== "" && words(earlier.label) === words(later.label));

export const redundantIssues = (typed: readonly Typed[], later: StepSnapshot, step: number): readonly UxIssue[] =>
  later.fields.flatMap((field) => {
    const earlier = typed.find((item) => item.step < step && sameInformation(item.entry, field));
    if (earlier === undefined || field.value.trim() !== "") return [];
    if (later.choices.some((choice) => choice.includes(earlier.value))) return [];
    const detail = `WCAG 3.3.7: step ${String(step + 1)} asks again for "${earlier.value}", typed in step ${String(earlier.step + 1)} at ${earlier.entry.sel}, without prefilling it or offering it to select`;
    return [issue(REDUNDANT_RULE, field.sel, detail, { advisory: true })];
  });

const fillStep = async (
  driver: StepDriver,
  snapshot: StepSnapshot,
  step: number,
  values: Readonly<Record<string, string>>,
): Promise<readonly Typed[]> => {
  const typed: Typed[] = [];
  for (const entry of snapshot.fields) {
    const value = entry.value === "" ? validValue(entry, values) : undefined;
    if (value === undefined) continue;
    await driver.fill(entry.sel, value);
    typed.push({ entry, value, step });
  }
  return typed;
};

export const redundantEntry = async (
  driver: StepDriver,
  steps: readonly string[],
  values: Readonly<Record<string, string>>,
): Promise<readonly UxIssue[]> => {
  const typed: Typed[] = [];
  const found: UxIssue[] = [];
  for (const [index, step] of steps.entries()) {
    const snapshot = await driver.snapshot(step);
    if (snapshot === undefined) {
      found.push(issue(REDUNDANT_RULE, step, `step ${String(index + 1)} was not found`, { unverified: true }));
      break;
    }
    found.push(...redundantIssues(typed, snapshot, index));
    if (index === steps.length - 1) break;
    typed.push(...(await fillStep(driver, snapshot, index, values)));
    await driver.submit(step);
  }
  return found;
};
