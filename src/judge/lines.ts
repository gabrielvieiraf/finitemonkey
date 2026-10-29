import type { Translate } from "../i18n/translate.js";
import type { ConceptView, JudgeResponse, ResultView, XrayRow } from "./response.js";

export const rowLine = (t: Translate, row: XrayRow): string =>
  t("judge.row", {
    claim: row.claim,
    state: row.state,
    band: row.band,
    text: row.text,
    outcome: row.outcome ?? "",
  });

export const resultLines = (t: Translate, view: ResultView): readonly string[] => [
  t(view.done ? "judge.result.done" : "judge.result.open", {
    source: view.source,
    total: view.total,
    count: view.modelOnly,
  }),
  ...view.rows.map((row) => rowLine(t, row)),
];

export const conceptLine = (t: Translate, view: ConceptView): string =>
  view.status === "suggested"
    ? t("judge.concept.suggested", { concept: view.label ?? view.concept })
    : t(view.because === undefined ? "judge.concept.none" : "judge.concept", {
        concept: view.label ?? view.concept,
        band: view.band,
        positive: view.positive,
        negative: view.negative,
        evidence: view.because?.evidence ?? "",
        proof: view.because?.proof ?? "",
        at: view.because?.at ?? "",
        request: view.request,
      });

const claimLines = (t: Translate, data: JudgeResponse): readonly string[] =>
  data.claim === undefined
    ? []
    : [
        t("judge.claim_line", {
          claim: data.claim.claim,
          state: data.claim.state,
          outcome: data.claim.outcome ?? "",
          text: data.claim.text,
        }),
      ];

export const judgeLines = (t: Translate, data: JudgeResponse): readonly string[] => [
  ...(data.entry === undefined ? [] : [t("judge.recorded", { id: data.entry })]),
  ...(data.result === undefined ? [] : resultLines(t, data.result)),
  ...(data.results ?? []).flatMap((view) => resultLines(t, view)),
  ...(data.concepts ?? []).map((view) => conceptLine(t, view)),
  ...(data.domains ?? []).map((view) => t("judge.domain", { ...view, parent: view.parent ?? "" })),
  ...claimLines(t, data),
  ...(data.handoff === undefined
    ? []
    : [t("judge.handoff", { claim: data.handoff.claim, to: data.handoff.to, missing: data.handoff.missing })]),
  ...(data.ask === undefined ? [] : [t("judge.ask", { ...data.ask })]),
  ...(data.export === undefined ? [] : [t("judge.export", { count: entriesIn(data) })]),
  ...(data.removed === undefined ? [] : [t("judge.removed", { count: data.removed })]),
];

const entriesIn = (data: JudgeResponse): number =>
  data.export === undefined
    ? 0
    : Object.values(data.export).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
