import type { Front, FrontsState } from "./state.js";

export interface FrontRow {
  readonly id: string;
  readonly status: string;
  readonly branch: string;
  readonly port: string;
  readonly age: string;
  readonly report: string;
  readonly blockedBy: string;
  readonly inbox: number;
}

export interface WaveSummary {
  readonly wave: number;
  readonly base: string;
  readonly running: number;
  readonly blocked: number;
  readonly maxConcurrent: number;
  readonly costUsd: number;
  readonly budgetUsd: number | null;
  readonly rows: readonly FrontRow[];
  readonly next: readonly string[];
}

const minutesSince = (now: string, at: string | null): string => {
  if (at === null) return "-";
  const minutes = Math.floor((Date.parse(now) - Date.parse(at)) / 60_000);
  if (!Number.isFinite(minutes)) return "-";
  return minutes < 60 ? `${String(minutes)}m` : `${String(Math.floor(minutes / 60))}h${String(minutes % 60)}m`;
};

const rowOf = (now: string, front: Front): FrontRow => ({
  id: front.id,
  status: front.status,
  branch: front.branch ?? "-",
  port: front.port === null ? "-" : String(front.port),
  age: minutesSince(now, front.startedAt),
  report: front.lastReport ?? "-",
  blockedBy: front.blockedBy.length === 0 ? "-" : front.blockedBy.join(","),
  inbox: front.inbox.length,
});

const nextSteps = (state: FrontsState): readonly string[] => {
  const merged = new Set(state.fronts.filter((front) => front.status === "merged").map((front) => front.id));
  return state.fronts.flatMap((front): string[] => {
    switch (front.status) {
      case "reported":
        return [`validate ${front.id} (front-report)`];
      case "verified":
        return [`merge ${front.id} into wave/${String(state.wave)}`];
      case "blocked": {
        const waiting = front.blockedBy.filter((id) => !merged.has(id));
        return waiting.length === 0 ? [`launch ${front.id}`] : [`release ${front.id} when ${waiting.join(", ")} merge`];
      }
      case "planned":
        return [`launch ${front.id}`];
      case "running":
      case "merged":
      case "dropped":
        return [];
    }
  });
};

export const summarize = (state: FrontsState, now: string): WaveSummary => ({
  wave: state.wave,
  base: state.base,
  running: state.fronts.filter((front) => front.status === "running").length,
  blocked: state.fronts.filter((front) => front.status === "blocked").length,
  maxConcurrent: state.maxConcurrent,
  costUsd: Math.round(state.fronts.reduce((total, front) => total + front.costUsd, 0) * 100) / 100,
  budgetUsd: state.budgetUsd,
  rows: state.fronts.map((front) => rowOf(now, front)),
  next: nextSteps(state),
});

const pad = (text: string, width: number): string =>
  text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;

export const statusTable = (summary: WaveSummary): readonly string[] => {
  const headers = ["id", "status", "branch", "port", "age", "last report", "blocked by"];
  const cells = summary.rows.map((row) => [
    row.id,
    row.status,
    row.branch,
    row.port,
    row.age,
    row.report,
    row.blockedBy,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...cells.map((cell) => (cell[index] ?? "").length)),
  );
  const render = (cell: readonly string[]): string =>
    cell
      .map((value, index) => pad(value, widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [render(headers), ...cells.map(render)];
};

export const statusSegment = (state: FrontsState): string | undefined => {
  if (state.fronts.length === 0) return undefined;
  const running = state.fronts.filter((front) => front.status === "running").length;
  const blocked = state.fronts.filter((front) => front.status === "blocked").length;
  return `fronts ${String(running)}/${String(state.maxConcurrent)}${blocked === 0 ? "" : `, ${String(blocked)} blocked`}`;
};
