import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { DATA_DIR } from "../core/data-dir.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { Fetched } from "./fetch.js";

export const PDF_EXTRACTOR = "pdftotext";
export const PDF_TIMEOUT_MS = 30_000;

export const isPdfId = (id: string): boolean => /\.pdf$/i.test(id.split(/[?#]/)[0] ?? "");

export const isPdfContent = (content: string): boolean => content.startsWith("%PDF");

export const pagesOf = (text: string): readonly string[] => {
  const pages = text.split("\f");
  return pages.at(-1)?.trim() === "" ? pages.slice(0, -1) : pages;
};

export const extractPdf = (runtime: Pick<Runtime, "exec">, file: AbsolutePath, cwd: AbsolutePath): Fetched => {
  const result = runtime.exec({
    command: PDF_EXTRACTOR,
    args: ["-enc", "UTF-8", file, "-"],
    cwd,
    timeoutMs: PDF_TIMEOUT_MS,
  });
  if (!result.found) return { status: "unreachable", detail: "pdf extractor missing" };
  if (result.timedOut || result.exitCode !== 0) return { status: "unreachable", detail: "pdf unreadable" };
  const pages = pagesOf(result.stdout);
  if (pages.every((page) => page.trim() === "")) return { status: "unreachable", detail: "pdf without text" };
  return { status: "ok", content: pages.join("\n"), pages };
};

export const pdfCachePath = (root: string, url: string): AbsolutePath =>
  toAbsolutePath(join(root, DATA_DIR, "judge", "pdf", `${sha256Hex(url).slice(0, 16)}.pdf`));

export const downloadPdf = (runtime: Pick<Runtime, "exec">, root: string, url: string, timeoutS: number): Fetched => {
  const file = pdfCachePath(root, url);
  const cwd = toAbsolutePath(root);
  const result = runtime.exec({
    command: "curl",
    args: ["-sL", "--create-dirs", "--max-time", String(timeoutS), "-o", file, url],
    cwd,
    timeoutMs: (timeoutS + 5) * 1000,
  });
  if (!result.found) return { status: "unreachable", detail: "curl missing" };
  if (result.timedOut || result.exitCode !== 0) return { status: "unreachable", detail: "network" };
  return extractPdf(runtime, file, cwd);
};
