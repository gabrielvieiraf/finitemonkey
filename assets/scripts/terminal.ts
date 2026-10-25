import { checks } from "./checks.ts";
import { palette } from "./palette.ts";
import { text, textWidth } from "./text.ts";
import type { Frame, Row } from "./timeline.ts";

const box = { x: 356, y: 28, width: 344, height: 286 } as const;
const left = box.x + 18;
const size = 2;
const cell = 6 * size;
const firstRow = 128;
const rowGap = 28;

export function terminal(frame: Frame): string {
  return `<rect x="${box.x + 4}" y="${box.y + 8}" width="${box.width}" height="${box.height}" rx="14" fill="#000000" opacity="0.28"/>` +
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="12" fill="${palette.terminal}" stroke="${palette.terminalEdge}" stroke-width="2"/>` +
    titleBar() +
    `<g opacity="${frame.fade}">${promptLine(frame)}${header(frame)}${frame.rows.map((row, index) => checkRow(row, index)).join("")}${verdictLine(frame)}</g>`;
}

function titleBar(): string {
  const y = box.y + 14;
  const title = "~/your-app";
  return `<path d="M${box.x + 1} ${box.y + 27}h${box.width - 2}" stroke="${palette.terminalEdge}" stroke-width="2"/>` +
    `<circle cx="${box.x + 18}" cy="${y}" r="5" fill="${palette.red}"/>` +
    `<circle cx="${box.x + 34}" cy="${y}" r="5" fill="${palette.amber}"/>` +
    `<circle cx="${box.x + 50}" cy="${y}" r="5" fill="${palette.green}"/>` +
    text(title, box.x + box.width / 2 - textWidth(title, 1.5) / 2, y - 6, 1.5, palette.dim);
}

function promptLine(frame: Frame): string {
  const y = 62;
  const typed = frame.prompt;
  const parts = text(typed.slice(0, 1), left, y, size, palette.green) +
    text(typed.slice(1), left + cell, y, size, palette.text);
  const cursorOn = frame.cursor && frame.beat % 4 < 2;
  const cursorX = left + [...typed].length * cell;
  return parts + (cursorOn ? `<rect x="${cursorX}" y="${y}" width="${cell - size}" height="${size * 7}" fill="${palette.amber}"/>` : "");
}

function header(frame: Frame): string {
  if (frame.run === 0) return "";
  const y = 92;
  const runLabel = `run #${frame.run}`;
  const lockLabel = `${frame.locked}/${checks.length} locked`;
  const right = box.x + box.width - 18;
  return text(runLabel, left, y, size, palette.dim) +
    text(lockLabel, right - textWidth(lockLabel, size), y, size, frame.locked > 0 ? palette.green : palette.dim) +
    `<path d="M${left} ${y + 22}h${right - left}" stroke="${palette.faint}" stroke-width="2" stroke-dasharray="4 4"/>`;
}

function checkRow(row: Row, index: number): string {
  const check = checks[index];
  if (check === undefined || row.kind === "hidden") return "";
  const y = firstRow + index * rowGap;
  const labelX = left + cell * 2;
  const statusX = left + cell * 11;
  const label = text(check.label, labelX, y, size, palette.text);
  switch (row.kind) {
    case "rolling":
      return text(row.spinner, left, y, size, palette.amber) + label + text(row.noise, statusX, y, size, palette.faint);
    case "fail":
      return text("✗", left, y, size, palette.red) + label + text(check.fail, statusX, y, size, palette.red);
    case "pass":
      return `<rect x="${left - 8}" y="${y - 5}" width="${box.width - 20}" height="24" rx="5" fill="${row.fresh ? "#22603f" : palette.greenSoft}"/>` +
        text("✓", left, y, size, palette.green) + label + text(check.pass, statusX, y, size, palette.green) +
        lock(box.x + box.width - 28, y - 1);
  }
}

function lock(x: number, y: number): string {
  return `<path d="M${x + 2} ${y + 7}v-3a4 4 0 0 1 8 0v3" fill="none" stroke="${palette.green}" stroke-width="2"/>` +
    `<rect x="${x}" y="${y + 6}" width="12" height="9" rx="2" fill="${palette.green}"/>`;
}

function verdictLine(frame: Frame): string {
  if (frame.verdict === "") return "";
  const y = 280;
  const big = 2.5;
  const badge = frame.badge > 0
    ? `<g transform="translate(${box.x + box.width - 36} ${y + 8}) scale(${frame.badge})">` +
      `<circle r="15" fill="${palette.green}"/>` +
      `<path d="M-7 0l5 5l9 -10" fill="none" stroke="${palette.terminal}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>`
    : "";
  return text(frame.verdict, left, y, big, palette.green) + badge;
}

