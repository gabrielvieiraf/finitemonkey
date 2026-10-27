import { parseCsv } from "../cost/csv.js";

export const PARITY_FILE = "parity.csv";
export const PARITY_STATE_FILE = "parity.json";
export const PARITY_COLUMNS = [
  "id",
  "capability",
  "where_today",
  "destination",
  "parity_test",
  "state",
  "decision",
] as const;

export interface ParityRow {
  readonly id: string;
  readonly capability: string;
  readonly whereToday: string;
  readonly destination: string;
  readonly parityTest: string;
  readonly state: string;
  readonly decision: string;
}

const cell = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const renderParity = (rows: readonly ParityRow[]): string =>
  [
    PARITY_COLUMNS.join(","),
    ...rows.map((row) =>
      [row.id, row.capability, row.whereToday, row.destination, row.parityTest, row.state, row.decision]
        .map(cell)
        .join(","),
    ),
  ].join("\n") + "\n";

export const parseParity = (text: string): readonly ParityRow[] => {
  const [header = [], ...body] = parseCsv(text);
  const at = (name: (typeof PARITY_COLUMNS)[number]): number => header.indexOf(name);
  const get = (cells: readonly string[], name: (typeof PARITY_COLUMNS)[number]): string =>
    (cells[at(name)] ?? "").trim();
  return body.map((cells) => ({
    id: get(cells, "id"),
    capability: get(cells, "capability"),
    whereToday: get(cells, "where_today"),
    destination: get(cells, "destination"),
    parityTest: get(cells, "parity_test"),
    state: get(cells, "state"),
    decision: get(cells, "decision"),
  }));
};

export const nextId = (rows: readonly ParityRow[]): number =>
  Math.max(0, ...rows.map((row) => Number.parseInt(row.id.replace(/^P/i, ""), 10)).filter(Number.isFinite)) + 1;
