import { glyphs } from "./glyphs.ts";

export const advance = 6;

export function textPath(content: string, x: number, y: number, size: number): string {
  const parts: string[] = [];
  let cursor = x;
  for (const char of content) {
    const rows = glyphs[char] ?? glyphs["?"] ?? [];
    rows.forEach((row, rowIndex) => {
      let start = -1;
      for (let col = 0; col <= row.length; col += 1) {
        const on = row[col] === "#";
        if (on && start < 0) start = col;
        if (!on && start >= 0) {
          parts.push(`M${round(cursor + start * size)} ${round(y + rowIndex * size)}h${round((col - start) * size)}v${round(size)}h${round(-(col - start) * size)}z`);
          start = -1;
        }
      }
    });
    cursor += advance * size;
  }
  return parts.join("");
}

export function text(content: string, x: number, y: number, size: number, fill: string, opacity = 1): string {
  const d = textPath(content, x, y, size);
  if (d === "") return "";
  const alpha = opacity < 1 ? ` fill-opacity="${opacity}"` : "";
  return `<path d="${d}" fill="${fill}"${alpha}/>`;
}

export function textWidth(content: string, size: number): number {
  return [...content].length * advance * size - size;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
