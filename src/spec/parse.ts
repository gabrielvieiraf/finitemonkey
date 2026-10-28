export type SpecFormat = "openspec" | "speckit" | "checklist";

export interface SpecItem {
  readonly from: string;
  readonly text: string;
  readonly line: number;
  readonly ears: boolean;
}

const CHECKBOX = /^\s*[-*]\s+\[[ xX]\]\s+(.*)$/;
const SPECKIT_ID = /^(T\d{3,})\s+/;
const OPENSPEC_ID = /^(\d+(?:\.\d+)+)\s+/;
const LABELS = /\[(?:P|US\d+|Story[^\]]*)\]\s*/g;
const EARS = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:when|while|if|where)\b.*\bshall\b/i;
const SHALL = /^\s*(?:[-*]\s*)?(?:the\s+\S+(?:\s+\S+)?\s+shall)\b/i;
const SCENARIO_WHEN = /^\s*[-*]\s*\*\*WHEN\*\*\s*(.+)$/;
const SCENARIO_THEN = /^\s*[-*]\s*\*\*THEN\*\*\s*(.+)$/;

export const formatOf = (path: string, text: string): SpecFormat => {
  if (/(^|[\\/])openspec[\\/]changes[\\/]/.test(path)) return "openspec";
  return /^\s*[-*]\s+\[[ xX]\]\s+T\d{3,}\b/m.test(text) ? "speckit" : "checklist";
};

const checkboxItem = (raw: string, line: number, index: number): SpecItem | undefined => {
  const body = CHECKBOX.exec(raw)?.[1];
  if (body === undefined) return undefined;
  const id = SPECKIT_ID.exec(body)?.[1] ?? OPENSPEC_ID.exec(body)?.[1];
  const text = body.replace(SPECKIT_ID, "").replace(OPENSPEC_ID, "").replace(LABELS, "").trim();
  return { from: id ?? `item-${String(index + 1)}`, text, line, ears: EARS.test(text) || SHALL.test(text) };
};

const scenarioItems = (lines: readonly string[]): readonly SpecItem[] =>
  lines.flatMap((raw, index) => {
    const when = SCENARIO_WHEN.exec(raw)?.[1];
    const then = lines
      .slice(index + 1, index + 4)
      .map((next) => SCENARIO_THEN.exec(next)?.[1])
      .find((item) => item !== undefined);
    return when === undefined || then === undefined
      ? []
      : [
          {
            from: `scenario-${String(index + 1)}`,
            text: `WHEN ${when.trim()} THE SYSTEM SHALL ${then.trim()}`,
            line: index + 1,
            ears: true,
          },
        ];
  });

export const parseSpec = (text: string): readonly SpecItem[] => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const boxes = lines.flatMap((raw, index) => checkboxItem(raw, index + 1, index) ?? []);
  const loose = lines.flatMap((raw, index) =>
    CHECKBOX.test(raw) || !(EARS.test(raw) || SHALL.test(raw))
      ? []
      : [
          {
            from: `ears-${String(index + 1)}`,
            text: raw
              .replace(/^\s*[-*]\s*/, "")
              .replace(/\*\*/g, "")
              .trim(),
            line: index + 1,
            ears: true,
          },
        ],
  );
  return [...boxes, ...loose, ...scenarioItems(lines)].sort((a, b) => a.line - b.line);
};
