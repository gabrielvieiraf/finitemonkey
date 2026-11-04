import { formatMessage, type Params } from "../i18n/message.js";
import type { ModApi } from "./api.js";
import { runCli } from "./cli.js";
import { MOD_LABELS_EN, MOD_LABELS_SCHEMA, type ModLabelKey } from "./labels-en.js";

export interface LabelSet {
  readonly lang: string;
  readonly labels: Readonly<Partial<Record<ModLabelKey, string>>>;
}

const ENGLISH: LabelSet = { lang: "en", labels: MOD_LABELS_EN };

let current: LabelSet = ENGLISH;

export const useLabels = (set: LabelSet | undefined): void => {
  current = set ?? ENGLISH;
};

export const labelLang = (): string => current.lang;

export const label = (key: ModLabelKey, params: Params = {}): string => {
  const own = current.labels[key];
  return own === undefined
    ? formatMessage(MOD_LABELS_EN[key], params, ENGLISH.lang)
    : formatMessage(own, params, current.lang);
};

export const count = (value: number): string => new Intl.NumberFormat(current.lang).format(value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isKey = (key: string): key is ModLabelKey => key in MOD_LABELS_EN;

export const parseLabels = (text: string): LabelSet | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["schema"] !== MOD_LABELS_SCHEMA || typeof data["lang"] !== "string") return undefined;
  const raw = isRecord(data["labels"]) ? data["labels"] : {};
  const labels: Partial<Record<ModLabelKey, string>> = {};
  for (const [key, value] of Object.entries(raw)) if (isKey(key) && typeof value === "string") labels[key] = value;
  return { lang: data["lang"], labels };
};

export async function refreshLabels($: ModApi): Promise<void> {
  const text = await runCli($, ["mod", "labels", "--json"]);
  const set = text === undefined ? undefined : parseLabels(text);
  if (set === undefined) return;
  useLabels(set);
  $.ui.invalidate("ui.render");
}

export function scheduleLabels($: ModApi): void {
  $.clock.after(0, () => refreshLabels($));
}
