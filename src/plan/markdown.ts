export const cell = (text: string): string => text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

export const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

export const row = (cells: readonly string[]): string => `| ${cells.map(cell).join(" | ")} |`;

export const table = (header: readonly string[], rows: readonly (readonly string[])[]): readonly string[] => [
  row(header),
  `|${header.map(() => "---").join("|")}|`,
  ...(rows.length === 0 ? [row(header.map(() => ""))] : rows.map(row)),
];

export const section = (heading: string, lines: readonly string[]): readonly string[] => [
  `## ${heading}`,
  "",
  ...lines,
  "",
];
