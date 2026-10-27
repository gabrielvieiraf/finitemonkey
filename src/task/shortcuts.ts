import { isRecord } from "../core/parsed.js";
import type { AcceptanceCheck } from "./types.js";

export interface Shortcut {
  readonly what: string;
  readonly ceiling?: string;
  readonly trigger?: string;
  readonly where?: string;
}

const KEYS = ["what", "ceiling", "trigger", "where"] as const;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const mentions = (what: string, check: AcceptanceCheck): boolean => {
  const lower = what.toLowerCase();
  const id = new RegExp(`(^|[^A-Za-z0-9_-])${check.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_-])`, "i");
  const texts = [check.description, check.run].filter((item): item is string => item !== undefined && item.length >= 6);
  return id.test(what) || texts.some((item) => lower.includes(item.toLowerCase()));
};

const shortcutAt = (
  value: unknown,
  index: number,
  acceptance: readonly AcceptanceCheck[],
  issues: string[],
): Shortcut | undefined => {
  const at = `shortcuts[${String(index)}]`;
  if (!isRecord(value)) {
    issues.push(`${at}: must be a mapping with what, ceiling, trigger and where`);
    return undefined;
  }
  const unknown = Object.keys(value).filter((key) => !KEYS.some((known) => known === key));
  if (unknown.length > 0) issues.push(`${at}: unknown keys ${unknown.join(", ")}`);
  const what = text(value["what"]);
  if (what === undefined) {
    issues.push(`${at}.what: required`);
    return undefined;
  }
  const scope = acceptance.find((check) => mentions(what, check));
  if (scope !== undefined)
    issues.push(`${at}: a shortcut is for how the task is done, never its scope; "${scope.id}" is an acceptance check`);
  const [ceiling, trigger, where] = [text(value["ceiling"]), text(value["trigger"]), text(value["where"])];
  return {
    what,
    ...(ceiling === undefined ? {} : { ceiling }),
    ...(trigger === undefined ? {} : { trigger }),
    ...(where === undefined ? {} : { where }),
  };
};

export const parseShortcuts = (
  value: unknown,
  acceptance: readonly AcceptanceCheck[],
  issues: string[],
): readonly Shortcut[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push("shortcuts: must be a list");
    return [];
  }
  return value.flatMap((item, index) => shortcutAt(item, index, acceptance, issues) ?? []);
};
