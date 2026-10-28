import type { GuardMode } from "../policy/policy.js";
import type { ApprovedScreen } from "./approved.js";
import { phraseIn } from "./copy.js";
import { type PageLayout, repeatedLayouts, similarity } from "./layout.js";
import type { PageResult } from "./node-capture.js";
import type { LookFinding, LookRule } from "./types.js";
import type { UiConfig } from "./ui.js";

const PERCENT = 100;

export const layoutsOf = (results: readonly PageResult[]): readonly PageLayout[] =>
  results.flatMap((result) =>
    result.measure === undefined
      ? []
      : [{ route: result.route, viewport: result.viewport, structure: result.measure.structure ?? [] }],
  );

const make = (
  rule: LookRule,
  page: Pick<PageLayout, "route" | "viewport">,
  detail: string,
  blocking: boolean,
): LookFinding => ({
  rule,
  route: page.route,
  viewport: page.viewport,
  detail,
  blocking,
});

const copyFindings = (results: readonly PageResult[], ui: UiConfig): readonly LookFinding[] =>
  results.flatMap((result) => {
    const phrase = phraseIn(result.measure?.text ?? "", ui.bannedCopy);
    return phrase === undefined ? [] : [make("look/banned-copy", result, `"${phrase}" is on the screen`, true)];
  });

const driftFindings = (
  pages: readonly PageLayout[],
  approved: readonly ApprovedScreen[],
  ui: UiConfig,
): readonly LookFinding[] =>
  pages.flatMap((page) => {
    const reference = approved.find((screen) => screen.route === page.route && screen.viewport === page.viewport);
    if (reference === undefined) return [];
    const score = similarity(page.structure, reference.structure);
    if (score >= ui.drift) return [];
    const detail = `structure ${String(Math.round(score * PERCENT))}% like the screen approved at ${reference.at}`;
    return [make("look/drift", page, detail, false)];
  });

const siblingFindings = (pages: readonly PageLayout[]): readonly LookFinding[] =>
  repeatedLayouts(pages).flatMap(([first, second]) => {
    const page = pages.find((item) => item.route === second);
    return page === undefined ? [] : [make("look/repeated-layout", page, `same section structure as ${first}`, false)];
  });

export const uiFindings = (
  results: readonly PageResult[],
  ui: UiConfig,
  approved: readonly ApprovedScreen[],
  mode: GuardMode,
): readonly LookFinding[] => {
  if (mode === "off") return [];
  const pages = layoutsOf(results);
  const found = [...copyFindings(results, ui), ...driftFindings(pages, approved, ui), ...siblingFindings(pages)];
  return mode === "active" ? found : found.map((item) => ({ ...item, blocking: false }));
};
