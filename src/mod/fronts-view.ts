import type { Elements, ModElement } from "./api.js";
import { markOf } from "./status.js";

export const FRONTS_PANE = "fm-fronts";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

const rowLine = (row: Readonly<Record<string, unknown>>): string =>
  [
    `${row["waiting"] === true ? "◆" : "●"} ${text(row["branch"], text(row["path"], "?"))}`,
    `gate ${markOf(text(row["gate"], "none"))}`,
    `contract ${text(row["contract"], "-")}`,
    ...(typeof row["lastActivity"] === "string" ? [`last ${row["lastActivity"].slice(0, 16).replace("T", " ")}`] : []),
    ...(row["waiting"] === true ? ["WAITING ON YOU"] : []),
  ].join("  ");

const collisionLine = (item: Readonly<Record<string, unknown>>): string => {
  const branches = Array.isArray(item["branches"]) ? item["branches"].map(String).join(", ") : "";
  return `collision: ${text(item["file"], "?")} in ${branches}`;
};

export const boardLines = (json: string): readonly string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["schema"] !== "finitemonkey/fronts-board@1") return [];
  const rows = Array.isArray(data["rows"]) ? data["rows"].filter(isRecord) : [];
  const collisions = Array.isArray(data["collisions"]) ? data["collisions"].filter(isRecord) : [];
  return [...rows.map(rowLine), ...collisions.map(collisionLine)];
};

export const frontsTree = (elements: Elements, lines: readonly string[], close: () => Promise<void>): ModElement =>
  elements.Box({
    key: "fm-fronts",
    flexDirection: "column",
    children: [
      ...(lines.length === 0 ? ["no worktrees found"] : lines).map((line) => elements.Text({ children: [line] })),
      elements.Button({ key: "fm-fronts-close", label: "Close", hotkey: "x", onPress: close }),
    ],
  });
