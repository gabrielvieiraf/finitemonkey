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

export interface FrontSession {
  readonly branch: string;
  readonly resume: string;
}

export interface BoardView {
  readonly lines: readonly string[];
  readonly sessions: readonly FrontSession[];
}

const EMPTY_BOARD: BoardView = { lines: [], sessions: [] };
const RESUME = /^claude --resume [A-Za-z0-9_-]{1,120}$/;

const sessionOf = (row: Readonly<Record<string, unknown>>): readonly FrontSession[] => {
  const resume = row["resume"];
  return typeof resume === "string" && RESUME.test(resume)
    ? [{ branch: text(row["branch"], text(row["path"], "?")), resume }]
    : [];
};

export const boardView = (json: string): BoardView => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return EMPTY_BOARD;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["schema"] !== "finitemonkey/fronts-board@1") return EMPTY_BOARD;
  const rows = Array.isArray(data["rows"]) ? data["rows"].filter(isRecord) : [];
  const collisions = Array.isArray(data["collisions"]) ? data["collisions"].filter(isRecord) : [];
  return { lines: [...rows.map(rowLine), ...collisions.map(collisionLine)], sessions: rows.flatMap(sessionOf) };
};

export const boardText = (board: BoardView): string =>
  [...board.lines, ...board.sessions.map((session) => `open ${session.branch}: ${session.resume}`)].join("\n");

export interface FrontsActions {
  readonly close: () => Promise<void>;
  readonly open: (session: FrontSession) => void;
}

export const frontsTree = (
  elements: Elements,
  board: BoardView,
  note: string | undefined,
  actions: FrontsActions,
): ModElement =>
  elements.Box({
    key: "fm-fronts",
    flexDirection: "column",
    children: [
      ...(board.lines.length === 0 ? ["no worktrees found"] : board.lines).map((line) =>
        elements.Text({ children: [line] }),
      ),
      ...board.sessions.map((session, index) =>
        elements.Button({
          key: `fm-fronts-open-${String(index)}`,
          label: `Open ${session.branch}`,
          onPress: () => {
            actions.open(session);
          },
        }),
      ),
      ...(note === undefined ? [] : [elements.Text({ key: "fm-fronts-note", children: [note] })]),
      elements.Button({ key: "fm-fronts-close", label: "Close", hotkey: "x", onPress: actions.close }),
    ],
  });

export const openNote = (session: FrontSession): string =>
  `This version of Claude Code gives a mod no way to open or message another session. In a terminal, run: ${session.resume}`;
