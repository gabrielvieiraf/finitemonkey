import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Browser } from "playwright-core";

import type { PageResult } from "./node-capture.js";

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

const card = (result: PageResult): string => {
  const image = (() => {
    try {
      return `<img src="data:image/png;base64,${readFileSync(result.path).toString("base64")}">`;
    } catch {
      return "<p>no capture</p>";
    }
  })();
  return `<figure><figcaption>${escapeHtml(result.route)} @ ${String(result.viewport)}px</figcaption>${image}</figure>`;
};

const STYLE = [
  "body{margin:16px;font:14px sans-serif;background:#fff;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}",
  "figure{margin:0;border:1px solid #ccc}",
  "figcaption{padding:4px 6px;background:#eee}",
  "img{display:block;width:100%;max-height:720px;object-fit:cover;object-position:top}",
].join("");

export const contactSheet = async (
  browser: Browser,
  results: readonly PageResult[],
  dir: string,
): Promise<string | undefined> => {
  const shown = results.filter((result) => result.loadError === undefined);
  if (shown.length === 0) return undefined;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.setContent(`<!doctype html><style>${STYLE}</style>${shown.map(card).join("")}`);
  const path = join(dir, "contact-sheet.png");
  await page.screenshot({ path, fullPage: true });
  await page.close();
  return path;
};
