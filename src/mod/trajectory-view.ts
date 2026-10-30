import type { ConceptId } from "../conceitos/concepts.js";
import type { DomainTrajectory, EvidenceRef, Mark, Week } from "../conceitos/trajectory.js";
import { rasterOf, svgOf, tableLines } from "../conceitos/trajectory-chart.js";
import type { Elements, ModElement, Surface } from "./api.js";

export const TRAJECTORY_PANE = "fm-trajectory";
const RASTER_ROWS = 8;
const MAX_COLUMNS = 96;

type Domain = DomainTrajectory["domain"];
const DOMAIN_NAMES: readonly Domain[] = ["product", "interface", "backend", "infrastructure", "security"];
const CONCEPTS: readonly ConceptId[] = [
  "api",
  "migration",
  "webhook",
  "idempotency",
  "force-push",
  "merge-conflict",
  "secret-in-code",
  "immutable-deploy",
];

export interface TrajectoryActions {
  readonly select: (mark: Mark) => Promise<void>;
  readonly close: () => Promise<void>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const records = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const str = (record: Readonly<Record<string, unknown>>, key: string): string =>
  typeof record[key] === "string" ? record[key] : "";

const orNull = (record: Readonly<Record<string, unknown>>, key: string): number | null =>
  typeof record[key] === "number" ? record[key] : null;

const num = (record: Readonly<Record<string, unknown>>, key: string): number =>
  typeof record[key] === "number" ? record[key] : 0;

const concept = (value: unknown): ConceptId => CONCEPTS.find((item) => item === value) ?? "api";

const weekOf = (item: Readonly<Record<string, unknown>>): Week => ({
  week: str(item, "week"),
  independent: orNull(item, "independent"),
  discernment: orNull(item, "discernment"),
  assisted: orNull(item, "assisted"),
  blindCovered: num(item, "blindCovered"),
  blindBare: num(item, "blindBare"),
  work: orNull(item, "work"),
  evidence: num(item, "evidence"),
});

const refOf = (item: Readonly<Record<string, unknown>>): EvidenceRef => ({
  kind: str(item, "kind"),
  at: str(item, "at"),
  concept: concept(item["concept"]),
  task: typeof item["task"] === "string" ? item["task"] : null,
  file: typeof item["file"] === "string" ? item["file"] : null,
});

const markOf = (item: Readonly<Record<string, unknown>>): Mark => ({
  kind: item["kind"] === "held" ? "held" : "ricochet",
  week: str(item, "week"),
  concept: concept(item["concept"]),
  at: str(item, "at"),
  evidence: records(item["evidence"]).map(refOf),
});

export const parseTrajectories = (text: string): readonly DomainTrajectory[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["schema"] !== "finitemonkey/trajectory@1") return [];
  return records(data["domains"]).flatMap((item): DomainTrajectory[] => {
    const domain = DOMAIN_NAMES.find((name) => name === item["domain"]);
    if (domain === undefined) return [];
    return [
      {
        domain,
        status: item["status"] === "ok" ? "ok" : "no_data",
        evidence: num(item, "evidence"),
        weeks: records(item["weeks"]).map(weekOf),
        marks: records(item["marks"]).map(markOf),
        position: typeof item["position"] === "string" ? item["position"] : null,
      },
    ];
  });
};

export const evidenceLines = (mark: Mark): readonly string[] => [
  `${mark.kind === "ricochet" ? "↯ ricochet" : "● held"} · ${mark.concept} · ${mark.week}`,
  ...mark.evidence.map(
    (item) =>
      `  ${item.kind} · task ${item.task ?? "-"} · ${item.file ?? "-"} · ${item.at.slice(0, 16).replace("T", " ")}`,
  ),
];

export const trajectoryText = (domains: readonly DomainTrajectory[]): string => tableLines(domains).join("\n");

const chartOf = (elements: Elements, item: DomainTrajectory, surface: Surface, columns: number): ModElement => {
  const raster = elements.Raster;
  const svg = elements.Svg;
  if (surface === "terminal" && raster !== undefined && item.status === "ok") {
    const cells = rasterOf(item, Math.max(12, Math.min(columns, MAX_COLUMNS)), RASTER_ROWS);
    return raster({ key: `fm-trajectory-raster-${item.domain}`, ...cells });
  }
  if ((surface === "desktop" || surface === "vscode") && svg !== undefined)
    return svg({
      key: `fm-trajectory-svg-${item.domain}`,
      source: svgOf(item),
      alt: `${item.domain}: where accepted work landed per week, with ricochets marked`,
    });
  return elements.Text({
    key: `fm-trajectory-text-${item.domain}`,
    children: [tableLines([item]).slice(1, 2).join("")],
  });
};

const markButtons = (elements: Elements, item: DomainTrajectory, actions: TrajectoryActions): readonly ModElement[] =>
  item.marks.length === 0
    ? []
    : [
        elements.Box({
          key: `fm-trajectory-marks-${item.domain}`,
          flexDirection: "row",
          columnGap: 2,
          children: item.marks.map((mark, index) =>
            elements.Button({
              key: `fm-trajectory-mark-${item.domain}-${String(index)}`,
              label: `${mark.kind === "ricochet" ? "↯" : "●"} ${mark.concept} ${mark.week.slice(-3)}`,
              onPress: () => actions.select(mark),
            }),
          ),
        }),
      ];

export const trajectoryTree = (
  elements: Elements,
  domains: readonly DomainTrajectory[],
  selected: Mark | undefined,
  surface: Surface,
  columns: number,
  actions: TrajectoryActions,
): ModElement =>
  elements.Box({
    key: "fm-trajectory",
    flexDirection: "column",
    children: [
      ...domains.flatMap((item) => [
        elements.Text({
          key: `fm-trajectory-head-${item.domain}`,
          bold: true,
          children: [
            item.status === "ok"
              ? `${item.domain} · ${String(item.evidence)} weighted events`
              : `${item.domain}: no data (${String(item.evidence)} weighted events)`,
          ],
        }),
        ...(item.status === "ok"
          ? [chartOf(elements, item, surface, columns), ...markButtons(elements, item, actions)]
          : []),
      ]),
      ...(selected === undefined
        ? []
        : evidenceLines(selected).map((line, index) =>
            elements.Text({ key: `fm-trajectory-evidence-${String(index)}`, children: [line] }),
          )),
      elements.Button({ key: "fm-trajectory-close", label: "Close", hotkey: "x", onPress: actions.close }),
    ],
  });
