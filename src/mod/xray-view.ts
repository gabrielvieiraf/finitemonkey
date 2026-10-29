import type { Elements, ModElement, Surface } from "./api.js";

export const XRAY_PANE = "fm-xray";

export interface XrayRow {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly band: string;
  readonly coverage: string;
  readonly concepts: readonly string[];
  readonly by: string;
}

export interface XrayView {
  readonly task: string;
  readonly beyond: number;
  readonly items: readonly XrayRow[];
}

export interface ConceptRow {
  readonly concept: string;
  readonly domain: string;
  readonly state: string;
  readonly positive: number;
  readonly negative: number;
  readonly exposures: number;
}

export interface XrayActions {
  readonly criterion: () => Promise<void>;
  readonly leave: (row: XrayRow) => Promise<void>;
  readonly skip: (row: XrayRow) => Promise<void>;
  readonly close: () => Promise<void>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (record: Readonly<Record<string, unknown>>, key: string): string =>
  typeof record[key] === "string" ? record[key] : "";

const num = (record: Readonly<Record<string, unknown>>, key: string): number =>
  typeof record[key] === "number" ? record[key] : 0;

const dataOf = (text: string, schema: string): Readonly<Record<string, unknown>> | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord(data) && data["schema"] === schema ? data : undefined;
};

const records = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

export const parseXray = (text: string): XrayView | undefined => {
  const data = dataOf(text, "finitemonkey/xray@1");
  if (data === undefined) return undefined;
  return {
    task: str(data, "task"),
    beyond: num(data, "beyondWithoutCriterion"),
    items: records(data["items"]).map((item) => ({
      file: str(item, "file"),
      start: num(item, "start"),
      end: num(item, "end"),
      band: str(item, "band"),
      coverage: str(item, "coverage"),
      concepts: records(item["concepts"]).map((entry) => str(entry, "concept")),
      by: str(item, "by"),
    })),
  };
};

export const parseConcepts = (text: string): readonly ConceptRow[] =>
  records(dataOf(text, "finitemonkey/concept-evidence@1")?.["concepts"]).map((item) => ({
    concept: str(item, "concept"),
    domain: str(item, "domain"),
    state: str(item, "state"),
    positive: num(item, "positive"),
    negative: num(item, "negative"),
    exposures: num(item, "exposures"),
  }));

const BAND_TEXT: Readonly<Record<string, string>> = {
  beyond: "beyond the evidence on record",
  unknown: "no record",
  edge: "at the edge",
  within: "within the evidence on record",
};

const COVERAGE_TEXT: Readonly<Record<string, string>> = {
  none: "no executable criterion",
  decorative: "criterion caught no planted defect",
  covered: "covered by a criterion",
};

export const rowLine = (row: XrayRow): string =>
  `${row.file} ${String(row.start)}-${String(row.end)}: ${BAND_TEXT[row.band] ?? row.band}, ${COVERAGE_TEXT[row.coverage] ?? row.coverage} (${row.concepts.join(", ") || "-"}; ${row.by === "agent" ? "written by the agent" : "changed outside the agent's tools"})`;

export const conceptLine = (row: ConceptRow): string =>
  `${row.concept} (${row.domain}): ${row.state === "unknown" ? "no record" : row.state} · ${String(row.positive)} for, ${String(row.negative)} against, ${String(row.exposures)} exposures`;

export const xrayLines = (view: XrayView, concepts: readonly ConceptRow[]): readonly string[] => [
  `x-ray ${view.task}: ${String(view.beyond)} beyond the record with no criterion, ${String(view.items.length)} changed blocks`,
  ...view.items.map(rowLine),
  ...concepts.filter((row) => row.state !== "unknown").map(conceptLine),
];

const STATE_COLOR: Readonly<Record<string, string>> = {
  demonstrated: "#2f7d4f",
  proximal: "#c28a1a",
  beyond: "#b3412f",
};

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const mapSvg = (concepts: readonly ConceptRow[]): string => {
  const known = concepts.filter((row) => row.state !== "unknown");
  const height = 24 * Math.max(known.length, 1) + 8;
  const rows = known.map((row, index) => {
    const y = 8 + index * 24;
    const color = STATE_COLOR[row.state] ?? "#888888";
    return `<rect x="8" y="${String(y)}" width="14" height="14" fill="${color}"/><text x="30" y="${String(y + 12)}" font-size="12" fill="currentColor">${escape(conceptLine(row))}</text>`;
  });
  const body =
    rows.length === 0
      ? `<text x="8" y="20" font-size="12" fill="currentColor">no concept evidence on record</text>`
      : rows.join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${String(height)}" viewBox="0 0 560 ${String(height)}">${body}</svg>`;
};

const needsAction = (row: XrayRow): boolean =>
  (row.band === "beyond" || row.band === "unknown") && row.coverage !== "covered";

const itemTree = (elements: Elements, row: XrayRow, actions: XrayActions): ModElement => {
  const key = `${row.file}:${String(row.start)}`;
  const text = elements.Text({ key: `fm-xray-text-${key}`, children: [rowLine(row)] });
  if (!needsAction(row)) return text;
  return elements.Box({
    key: `fm-xray-item-${key}`,
    flexDirection: "column",
    children: [
      text,
      elements.Box({
        key: `fm-xray-actions-${key}`,
        flexDirection: "row",
        columnGap: 2,
        children: [
          elements.Button({ key: `fm-xray-criterion-${key}`, label: "Create criterion", onPress: actions.criterion }),
          elements.Button({
            key: `fm-xray-leave-${key}`,
            label: "Leave it to the machine",
            onPress: () => actions.leave(row),
          }),
          elements.Button({ key: `fm-xray-skip-${key}`, label: "Skip", onPress: () => actions.skip(row) }),
        ],
      }),
    ],
  });
};

export const xrayTree = (
  elements: Elements,
  view: XrayView | undefined,
  concepts: readonly ConceptRow[],
  actions: XrayActions,
  surface: Surface,
): ModElement => {
  const svg = surface === "desktop" || surface === "vscode" ? elements.Svg : undefined;
  const map =
    svg === undefined
      ? concepts
          .filter((row) => row.state !== "unknown")
          .map((row) => elements.Text({ key: `fm-xray-concept-${row.concept}`, children: [conceptLine(row)] }))
      : [svg({ key: "fm-xray-map", source: mapSvg(concepts), alt: "concept evidence on record, one row per concept" })];
  return elements.Box({
    key: "fm-xray",
    flexDirection: "column",
    children: [
      elements.Text({
        key: "fm-xray-head",
        children: [
          view === undefined
            ? "no x-ray for this folder"
            : `X-ray ${view.task}: ${String(view.beyond)} beyond the record with no criterion`,
        ],
      }),
      ...(view?.items ?? []).map((row) => itemTree(elements, row, actions)),
      elements.Text({ key: "fm-xray-map-head", dimColor: true, children: ["What is on record, per concept:"] }),
      ...map,
      elements.Button({ key: "fm-xray-close", label: "Close", hotkey: "x", onPress: actions.close }),
    ],
  });
};
