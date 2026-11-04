import { isRecord, parseJsonObject } from "../core/parsed.js";

export const DEEP_TOOL = "lighthouse";
export const DEEP_CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
export const DEEP_ROUTE_TIMEOUT_MS = 120_000;

export interface DeepScore {
  readonly category: string;
  readonly score: number;
}

export interface DeepRoute {
  readonly route: string;
  readonly scores: readonly DeepScore[];
  readonly error: string | null;
}

export interface DeepReport {
  readonly tool: string | null;
  readonly routes: readonly DeepRoute[];
}

export type DeepRunner = (baseUrl: string, routes: readonly string[]) => DeepReport;

export const deepArgs = (url: string): readonly string[] => [
  url,
  "--output=json",
  "--output-path=stdout",
  "--quiet",
  "--no-enable-error-reporting",
  "--chrome-flags=--headless=new",
  `--only-categories=${DEEP_CATEGORIES.join(",")}`,
];

export const deepEnv: Readonly<Record<string, string>> = { CI: "1" };

export const parseDeep = (text: string): readonly DeepScore[] | undefined => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return undefined;
  const categories = parsed.value["categories"];
  if (!isRecord(categories)) return undefined;
  return DEEP_CATEGORIES.flatMap((category): DeepScore[] => {
    const entry = categories[category];
    const score = isRecord(entry) ? entry["score"] : undefined;
    return typeof score === "number" ? [{ category, score: Math.round(score * 100) }] : [];
  });
};

export const deepLines = (report: DeepReport): readonly string[] =>
  report.routes.map((item) =>
    item.error === null
      ? `${report.tool ?? DEEP_TOOL} ${item.route}: ${item.scores.map((score) => `${score.category} ${String(score.score)}`).join(", ")}`
      : `${report.tool ?? DEEP_TOOL} ${item.route}: ${item.error}`,
  );
