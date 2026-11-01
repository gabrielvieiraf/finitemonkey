import { fixOf, RESEARCH_GLYPH } from "../conceitos/trajectory-research.js";
import type { Elements, ModElement } from "./api.js";

export const JUDGE_PANE = "fm-judge";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const eventLine = (event: Readonly<Record<string, unknown>>): string => {
  const fix = fixOf({
    state: event["state"] === "held" ? "held" : event["state"] === "pending" ? "pending" : "open",
    ...(typeof event["fixedBy"] === "string" ? { fixedBy: event["fixedBy"] } : {}),
  });
  const commit = text(event["fixedCommit"]);
  return [
    `${RESEARCH_GLYPH[fix]} ${text(event["claim"])}`,
    text(event["cause"]),
    fix === "open" ? "open" : `fixed by ${fix}${commit === "" ? "" : ` in ${commit.slice(0, 7)}`}`,
    text(event["at"]).slice(0, 10),
  ].join("  ");
};

export const judgeLines = (json: string): readonly string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["verb"] !== "trajectory") return [];
  const events = Array.isArray(data["events"]) ? data["events"].filter(isRecord) : [];
  return events.map(eventLine);
};

export const judgeTree = (elements: Elements, lines: readonly string[], close: () => Promise<void>): ModElement =>
  elements.Box({
    key: "fm-judge",
    flexDirection: "column",
    children: [
      ...(lines.length === 0 ? ["no research ricochet recorded"] : lines).map((line) =>
        elements.Text({ children: [line] }),
      ),
      elements.Button({ key: "fm-judge-close", label: "Close", hotkey: "x", onPress: close }),
    ],
  });
