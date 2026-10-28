const HEADER = /^(\s*)(.*?)([|>])([-+]?)([1-9]?)\s*$/;

const indentOf = (line: string): number => line.length - line.trimStart().length;

const isHeader = (head: string): boolean => head.endsWith(":") || /(?:^|\s)-$/.test(head);

const joint = (previous: string, line: string): string => {
  if (line === "") return "\n";
  if (previous === "") return line;
  return line.startsWith(" ") || previous.startsWith(" ") ? `\n${line}` : ` ${line}`;
};

const fold = (lines: readonly string[]): string =>
  lines.reduce((out, line, index) => (index === 0 ? line : `${out}${joint(lines[index - 1] ?? "", line)}`), "");

interface Block {
  readonly value: string;
  readonly end: number;
}

const blockAt = (raw: readonly string[], start: number, parent: number, style: string, chomp: string): Block => {
  let end = start + 1;
  while (end < raw.length && ((raw[end] ?? "").trim() === "" || indentOf(raw[end] ?? "") > parent)) end += 1;
  const body = raw.slice(start + 1, end);
  const filled = body.filter((line) => line.trim() !== "");
  const indent = Math.min(...filled.map(indentOf));
  let last = body.length;
  while (last > 0 && (body[last - 1] ?? "").trim() === "") last -= 1;
  const content = body.slice(0, last).map((line) => (line.trim() === "" ? "" : line.slice(indent)));
  const text = style === "|" ? content.join("\n") : fold(content);
  const trailing = "\n".repeat(Math.max(0, body.length - last));
  const value = chomp === "-" || text === "" ? text : chomp === "+" ? `${text}\n${trailing}` : `${text}\n`;
  return { value, end };
};

export const collapseBlockScalars = (raw: readonly string[], strip: (text: string) => string): readonly string[] => {
  const out = [...raw];
  for (let index = 0; index < out.length; index += 1) {
    const match = HEADER.exec(strip(out[index] ?? "").trimEnd());
    const [, lead = "", head = "", style = "", chomp = ""] = match ?? [];
    if (match === null || !isHeader(head.trimEnd())) continue;
    const dashes = /^(?:-\s+)*/.exec(head)?.[0].length ?? 0;
    const block = blockAt(out, index, lead.length + (head.trimEnd() === "-" ? 0 : dashes), style, chomp);
    out[index] = `${lead}${head.trimEnd()} ${JSON.stringify(block.value)}`;
    for (let line = index + 1; line < block.end; line += 1) out[line] = "";
    index = block.end - 1;
  }
  return out;
};
