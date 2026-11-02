import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { CITE_FEATURE } from "../judge/cite.js";
import { PDF_EXTRACTOR } from "../judge/pdf.js";
import { featureMode } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { type Check, finding } from "./types.js";

export const PDF_PROBE_TIMEOUT_MS = 5000;

export const checkPdfExtractor: Check = ({ runtime, root }) => {
  if (!runtime.readText(toAbsolutePath(join(root, ".finitemonkey", "judge.jsonl"))).ok) return [];
  if (featureMode(runtime, fmPaths(root), CITE_FEATURE) === "off") return [];
  const result = runtime.probe(PDF_EXTRACTOR, ["-v"], PDF_PROBE_TIMEOUT_MS);
  return result.found
    ? [finding("pdf", "ok", "doctor.pdf.ok", { extractor: PDF_EXTRACTOR })]
    : [finding("pdf", "warn", "doctor.pdf.missing", { extractor: PDF_EXTRACTOR }, "doctor.pdf.fix")];
};
