import type { Translate } from "../i18n/translate.js";
import { RULE_FIX_KEYS, rulesOf, spanRules } from "../prose/describe.js";
import type { ProseFileReport } from "../prose/gate.js";
import { ALLOW_MARKER } from "../prose/marker.js";
import type { ProseHit, ProseRuleId, ProseSpan } from "../prose/types.js";

export const PROSE_CHECK_SCHEMA = "finitemonkey/prose-check@1";

export interface ProseSpanView {
  readonly startLine: number;
  readonly endLine: number;
  readonly score: number;
  readonly rules: readonly ProseRuleId[];
  readonly hits: readonly Omit<ProseHit, "unit">[];
}

export interface ProseFileView {
  readonly file: string;
  readonly allowed: boolean;
  readonly spans: readonly ProseSpanView[];
}

export interface ProseCheckData {
  readonly schema: typeof PROSE_CHECK_SCHEMA;
  readonly files: readonly ProseFileView[];
  readonly summary: { readonly files: number; readonly flagged: number; readonly spans: number };
}

const spanView = (span: ProseSpan): ProseSpanView => ({
  startLine: span.startLine,
  endLine: span.endLine,
  score: span.score,
  rules: rulesOf([span]),
  hits: span.hits.map(({ rule, line, weight, excerpt }) => ({ rule, line, weight, excerpt })),
});

export const proseCheckData = (reports: readonly ProseFileReport[]): ProseCheckData => {
  const files = reports.map(({ file, report }) => ({
    file,
    allowed: report.allowed,
    spans: report.spans.map(spanView),
  }));
  return {
    schema: PROSE_CHECK_SCHEMA,
    files,
    summary: {
      files: files.length,
      flagged: files.filter((file) => file.spans.length > 0).length,
      spans: files.reduce((sum, file) => sum + file.spans.length, 0),
    },
  };
};

const fileLines = (t: Translate, report: ProseFileReport): readonly string[] => {
  if (report.report.allowed) return [t("prose.check.allowed", { file: report.file, marker: ALLOW_MARKER })];
  const { spans } = report.report;
  if (spans.length === 0) return [];
  return [
    t("prose.check.file", { file: report.file, count: spans.length }),
    ...spans.flatMap((span) => [
      t("prose.check.span", {
        file: report.file,
        start: span.startLine,
        end: span.endLine,
        score: span.score,
        rules: spanRules(span),
      }),
      ...rulesOf([span]).map((rule) => t("prose.check.fix", { fix: `${rule}: ${t(RULE_FIX_KEYS[rule])}` })),
    ]),
  ];
};

export const proseCheckHuman = (
  t: Translate,
  reports: readonly ProseFileReport[],
  data: ProseCheckData,
): readonly string[] => [
  ...reports.flatMap((report) => fileLines(t, report)),
  ...(data.summary.spans === 0 ? [t("prose.check.clean", { count: data.summary.files })] : []),
];
