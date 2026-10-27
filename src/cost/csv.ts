export type CsvRow = readonly string[];

const nextCell = (line: string, start: number): { readonly cell: string; readonly end: number } => {
  if (line.charAt(start) !== '"') {
    const comma = line.indexOf(",", start);
    const end = comma === -1 ? line.length : comma;
    return { cell: line.slice(start, end), end };
  }
  let cell = "";
  let index = start + 1;
  while (index < line.length) {
    const char = line.charAt(index);
    if (char === '"' && line.charAt(index + 1) === '"') {
      cell += '"';
      index += 2;
    } else if (char === '"') {
      return { cell, end: index + 1 };
    } else {
      cell += char;
      index += 1;
    }
  }
  return { cell, end: index };
};

export const parseCsvLine = (line: string): CsvRow => {
  const cells: string[] = [];
  let index = 0;
  for (;;) {
    const { cell, end } = nextCell(line, index);
    cells.push(cell);
    if (end >= line.length) return cells;
    index = end + 1;
  }
};

export const parseCsv = (text: string): readonly CsvRow[] =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseCsvLine);
