import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Browser, Page } from "playwright-core";

import { isRecord } from "../core/parsed.js";
import type { ApprovedScreen } from "./approved.js";
import { slugOf } from "./node-capture.js";
import type { ProbeBox } from "./probe.js";
import { type Cell, CELL_PX, regionsOf, type VisualDiff, type VisualTolerance } from "./visual.js";

const DIFF_SCRIPT = `async ([base, next, threshold, cell]) => {
  const load = (src) => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });
  const [left, right] = await Promise.all([load(base), load(next)]);
  const width = Math.max(left.width, right.width);
  const height = Math.max(left.height, right.height);
  const pixels = (img) => { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, width, height).data; };
  const a = pixels(left);
  const b = pixels(right);
  let changed = 0;
  const cells = new Set();
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3])) / 255;
    if (delta <= threshold) continue;
    changed += 1;
    const at = i / 4;
    cells.add(Math.floor((at % width) / cell) + "," + Math.floor(Math.floor(at / width) / cell));
  }
  return { changed, cells: [...cells], sizeChanged: left.width !== right.width || left.height !== right.height };
}`;

const dataUrl = (path: string): string => `data:image/png;base64,${readFileSync(path).toString("base64")}`;

const cellsOf = (value: unknown): readonly Cell[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        if (typeof item !== "string") return [];
        const [col = Number.NaN, row = Number.NaN] = item.split(",").map(Number);
        return Number.isFinite(col) && Number.isFinite(row) ? [{ col, row }] : [];
      })
    : [];

const compare = async (page: Page, base: string, next: string, tolerance: VisualTolerance) => {
  const raw: unknown = await page.evaluate(
    `(${DIFF_SCRIPT})(${JSON.stringify([dataUrl(base), dataUrl(next), tolerance.threshold, CELL_PX])})`,
  );
  if (!isRecord(raw)) return { changed: 0, cells: [], sizeChanged: false };
  return {
    changed: typeof raw["changed"] === "number" ? raw["changed"] : 0,
    cells: cellsOf(raw["cells"]),
    sizeChanged: raw["sizeChanged"] === true,
  };
};

const SHEET = (base: string, next: string, boxes: readonly ProbeBox[]): string =>
  [
    "<!doctype html><style>body{margin:8px;font:14px sans-serif;display:flex;gap:12px;align-items:flex-start}",
    "figure{margin:0;position:relative}figcaption{padding:4px;background:#eee}img{display:block;max-width:700px}",
    ".box{position:absolute;border:3px solid #e00;box-sizing:border-box}</style>",
    `<figure><figcaption>approved</figcaption><img src="${dataUrl(base)}"></figure>`,
    `<figure><figcaption>current</figcaption><div style="position:relative"><img id="cur" src="${dataUrl(next)}">`,
    ...boxes.map(
      (box) =>
        `<div class="box" data-x="${String(box.x)}" data-y="${String(box.y)}" data-w="${String(box.w)}" data-h="${String(box.h)}"></div>`,
    ),
    "</div></figure>",
    "<script>const img=document.getElementById('cur');const k=img.clientWidth/img.naturalWidth;for(const b of document.querySelectorAll('.box')){b.style.left=b.dataset.x*k+'px';b.style.top=b.dataset.y*k+'px';b.style.width=b.dataset.w*k+'px';b.style.height=b.dataset.h*k+'px';}</script>",
  ].join("");

export interface VisualInput {
  readonly captures: readonly { readonly route: string; readonly viewport: number; readonly path: string }[];
  readonly approved: readonly ApprovedScreen[];
  readonly imagesDir: string;
  readonly dir: string;
  readonly tolerance: VisualTolerance;
}

export const approvedImage = (imagesDir: string, route: string, viewport: number): string =>
  join(imagesDir, `${slugOf(route)}-${String(viewport)}.png`);

export const visualDiffs = async (browser: Browser, input: VisualInput): Promise<readonly VisualDiff[]> => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    const diffs: VisualDiff[] = [];
    for (const capture of input.captures) {
      const base = approvedImage(input.imagesDir, capture.route, capture.viewport);
      const known = input.approved.some(
        (screen) => screen.route === capture.route && screen.viewport === capture.viewport && screen.image === true,
      );
      if (!known || !existsSync(base) || !existsSync(capture.path)) continue;
      const found = await compare(page, base, capture.path, input.tolerance);
      const over = found.changed > input.tolerance.maxDiffPixels;
      const regions = over ? regionsOf(found.cells, CELL_PX) : [];
      let sideBySide: string | undefined;
      if (over || found.sizeChanged) {
        sideBySide = join(input.dir, `${slugOf(capture.route)}-${String(capture.viewport)}.visual.png`);
        await page.setContent(SHEET(base, capture.path, regions));
        await page.screenshot({ path: sideBySide, fullPage: true });
      }
      diffs.push({
        route: capture.route,
        viewport: capture.viewport,
        changed: over ? found.changed : 0,
        regions,
        sideBySide,
        sizeChanged: found.sizeChanged,
      });
    }
    return diffs;
  } finally {
    await page.close();
  }
};

export const storeApprovedImages = (
  captures: readonly { readonly route: string; readonly viewport: number; readonly path: string }[],
  imagesDir: string,
): number => {
  const present = captures.filter((capture) => existsSync(capture.path));
  if (present.length === 0) return 0;
  try {
    mkdirSync(imagesDir, { recursive: true });
    for (const capture of present)
      copyFileSync(capture.path, approvedImage(imagesDir, capture.route, capture.viewport));
    return present.length;
  } catch {
    return 0;
  }
};
