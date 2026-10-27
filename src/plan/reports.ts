import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { planFiles, planPath } from "./folder.js";
import { readFront } from "./front.js";

export const MASTER_FILE = "MASTER.md";
export const PREVIOUS_PREFIX = "MASTER-previous-";

const REPORT = /^\d{2,}[a-z]?-.+\.md$/;
const REVOKED_STATUS = /^\s*(?:[-*]\s*)?\**status\**\s*:\s*\**\s*(revoked|revogad[oa]|revocad[oa])\b/im;
const BANNER = /^>\s*\**\s*(revoked|revogad[oa]|revocad[oa])\b/im;

export interface PlanReport {
  readonly name: string;
  readonly text: string;
  readonly body: string;
  readonly revoked: boolean;
  readonly banner: boolean;
}

export const isReportName = (name: string): boolean => REPORT.test(name);

export const readReport = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  name: string,
): PlanReport | undefined => {
  const text = runtime.readText(planPath(root, name));
  if (!text.ok) return undefined;
  const { data, body } = readFront(text.value);
  const status = data?.["status"];
  const revoked =
    (typeof status === "string" && /^(revoked|revogad[oa]|revocad[oa])$/i.test(status)) || REVOKED_STATUS.test(body);
  return { name, text: text.value, body, revoked, banner: BANNER.test(body) };
};

export const planReports = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  root: AbsolutePath,
): readonly PlanReport[] =>
  planFiles(runtime, root)
    .filter(isReportName)
    .flatMap((name) => readReport(runtime, root, name) ?? []);

export const previousVersions = (names: readonly string[]): readonly string[] =>
  names.filter((name) => name.startsWith(PREVIOUS_PREFIX) && name.endsWith(".md")).sort();

const CITATION = /\b\d{2,}[a-z]?-[\w.-]+?\.md\b/g;

export const citationsIn = (line: string): readonly string[] => [...line.matchAll(CITATION)].map((match) => match[0]);
