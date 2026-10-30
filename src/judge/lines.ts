import type { Translate } from "../i18n/translate.js";
import type { ConceptView, JudgeResponse, ProbeView, ResultView, XrayRow } from "./response.js";

export const rowLine = (t: Translate, row: XrayRow): string =>
  [
    t("judge.row", { claim: row.claim, state: row.state, band: row.band, text: row.text, outcome: row.outcome ?? "" }),
    ...(row.actions.length === 0 ? [] : [t("judge.row.actions", { actions: row.actions.join(", ") })]),
  ].join(" ");

const probeLines = (t: Translate, probe: ProbeView): readonly string[] => {
  if (probe.span !== undefined) return [t("judge.probe.wrong", { span: probe.span, claim: probe.claim })];
  if (probe.answered) return [t("judge.probe.right", { claim: probe.claim })];
  return [
    t("judge.probe.two_spans", { probe: probe.probe, source: probe.prompt }),
    ...probe.options.map((option, index) => `  ${String(index + 1)}) ${option}`),
  ];
};

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
        ...(data.claim.numbers ?? []).map((item) =>
          t("judge.number", { number: item.number, state: item.state, anchor: item.anchor ?? "" }),
        ),
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
  ...(data.probe === undefined ? [] : probeLines(t, data.probe)),
  ...(data.item === undefined
    ? []
    : [
        t("judge.item", {
          item: data.item.item,
          origin: data.item.origin,
          source: data.item.source,
          instructions: data.item.instructions,
        }),
        data.item.data,
      ]),
  ...(data.exceptions === undefined || data.exceptions.length === 0
    ? []
    : [
        t("judge.exceptions", {
          count: data.exceptions.length,
          numbers: data.exceptions.map((item) => item.number).join(", "),
        }),
      ]),
];

const entriesIn = (data: JudgeResponse): number =>
  data.export === undefined
    ? 0
    : Object.values(data.export).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
