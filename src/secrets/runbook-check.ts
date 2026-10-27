export const RUNBOOK_SECTIONS = [
  "## 1. Revoke",
  "## 2. Issue the new credential",
  "## 3. Replace it in every consumer",
  "## 4. Check for misuse in the exposure window",
  "## 5. Delete the old credential after observation",
  "## 6. Notification duties",
  "## Sources",
] as const;

export const SOURCE_MAX_AGE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

const SOURCE_LINE = /^- (https:\/\/\S+) \(accessed (\d{4}-\d{2}-\d{2})\)$/;

const sectionProblems = (text: string): readonly string[] => {
  const headings = text.split("\n").filter((line) => line.startsWith("## "));
  const expected: readonly string[] = RUNBOOK_SECTIONS;
  return headings.join("\n") === expected.join("\n")
    ? []
    : [`sections must be, in order: ${RUNBOOK_SECTIONS.join(" | ")}`];
};

const sourceLines = (text: string): readonly string[] => {
  const start = text.indexOf("\n## Sources\n");
  if (start === -1) return [];
  return text
    .slice(start + "\n## Sources\n".length)
    .split("\n")
    .filter((line) => line.trim() !== "");
};

const sourceProblem = (line: string, todayMs: number): string | undefined => {
  const match = SOURCE_LINE.exec(line.trim());
  const url = match?.[1];
  const accessed = match?.[2];
  if (url === undefined || accessed === undefined)
    return `source line must be "- <https url> (accessed YYYY-MM-DD)": ${line}`;
  const accessedMs = Date.parse(`${accessed}T00:00:00Z`);
  if (Number.isNaN(accessedMs)) return `source ${url} has an invalid access date ${accessed}`;
  const age = Math.floor((todayMs - accessedMs) / DAY_MS);
  if (age > SOURCE_MAX_AGE_DAYS)
    return `source ${url} was accessed ${String(age)} days ago (limit ${String(SOURCE_MAX_AGE_DAYS)}); read it again and update the steps and the date`;
  return age < 0 ? `source ${url} has an access date in the future` : undefined;
};

export const runbookProblems = (text: string, today: string): readonly string[] => {
  const todayMs = Date.parse(today);
  const sources = sourceLines(text);
  return [
    ...sectionProblems(text.replace(/\r\n/g, "\n")),
    ...(sources.length === 0 ? ["at least one official source is required under ## Sources"] : []),
    ...sources.flatMap((line) => sourceProblem(line, todayMs) ?? []),
  ];
};
