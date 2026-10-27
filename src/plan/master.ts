import type { AbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import type { Translate } from "../i18n/translate.js";
import { PLAN_DIR, planDir, planFiles, planPath } from "./folder.js";
import { MASTER_FILE, planReports, PREVIOUS_PREFIX, previousVersions } from "./reports.js";
import { indexIssues } from "./rules.js";
import { MASTER_SECTIONS, SECTION_KEYS, sectionOf, sectionsOf } from "./sections.js";

const HINTS: Partial<Record<(typeof MASTER_SECTIONS)[number], Parameters<Translate>[0]>> = {
  decisions: "plan.hint.decisions",
  numbers: "plan.hint.numbers",
  reports: "plan.hint.reports",
};

export const renderMaster = (t: Translate): string =>
  [
    `# ${t("plan.master.title")}`,
    "",
    ...MASTER_SECTIONS.flatMap((id) => {
      const hint = HINTS[id];
      const table =
        id === "responsibilities"
          ? [`| ${t("plan.col.responsibility")} | ${t("plan.col.owner")} |`, "|---|---|", ""]
          : [];
      return [`## ${t(SECTION_KEYS[id])}`, "", ...(hint === undefined ? [] : [t(hint), ""]), ...table];
    }),
  ].join("\n");

export interface PlanInit {
  readonly file: string;
  readonly created: boolean;
}

export const initPlan = (runtime: Runtime, t: Translate, root: AbsolutePath): Parsed<PlanInit> => {
  const file = `${PLAN_DIR}/${MASTER_FILE}`;
  if (runtime.readText(planPath(root, MASTER_FILE)).ok) return accept({ file, created: false });
  const made = runtime.mkdir(planDir(root));
  if (!made.ok) return made;
  const written = runtime.writeText(planPath(root, MASTER_FILE), renderMaster(t));
  return written.ok ? accept({ file, created: true }) : written;
};

const PREVIOUS = /^MASTER-previous-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/;

const order = (name: string): string => {
  const match = PREVIOUS.exec(name);
  return `${match?.[1] ?? ""}-${(match?.[2] ?? "1").padStart(4, "0")}`;
};

export const latestPrevious = (names: readonly string[]): string | undefined =>
  [...previousVersions(names)].sort((a, b) => order(a).localeCompare(order(b))).at(-1);

const previousName = (runtime: Runtime, root: AbsolutePath, date: string, current: string): string => {
  for (let index = 1; ; index += 1) {
    const name = `${PREVIOUS_PREFIX}${date}${index === 1 ? "" : `-${String(index)}`}.md`;
    const text = runtime.readText(planPath(root, name));
    if (!text.ok || text.value === current) return name;
  }
};

export interface NewReport {
  readonly file: string;
  readonly text: string;
}

export interface Consolidation {
  readonly previous: string;
  readonly reports: readonly NewReport[];
}

const textForPlan = (body: string): string => {
  const sections = sectionsOf(body);
  const section = sectionOf(sections, "plan.text_for_plan") ?? sectionOf(sections, "decision.section.plan_change");
  return (section?.lines ?? [])
    .map((line) => line.text)
    .join("\n")
    .trim();
};

export const startConsolidation = (runtime: Runtime, root: AbsolutePath, date: string): Parsed<Consolidation> => {
  const current = runtime.readText(planPath(root, MASTER_FILE));
  if (!current.ok) return reject("no_master");
  const name = previousName(runtime, root, date, current.value);
  const saved = runtime.writeText(planPath(root, name), current.value);
  if (!saved.ok) return saved;
  const reports = planReports(runtime, root);
  const missing = new Set(
    indexIssues(
      MASTER_FILE,
      sectionsOf(current.value),
      reports.map((report) => report.name),
    ).map((item) => item.detail),
  );
  return accept({
    previous: `${PLAN_DIR}/${name}`,
    reports: reports
      .filter((report) => missing.has(report.name))
      .map((report) => ({
        file: `${PLAN_DIR}/${report.name}`,
        text: textForPlan(report.body),
      })),
  });
};

export const masterDiff = (
  runtime: Runtime,
  root: AbsolutePath,
): { readonly previous?: string; readonly diff: string } => {
  const previous = latestPrevious(planFiles(runtime, root));
  if (previous === undefined) return { diff: "" };
  const result = gitAt(runtime, root).run([
    "diff",
    "--no-index",
    "--no-color",
    "--",
    `${PLAN_DIR}/${previous}`,
    `${PLAN_DIR}/${MASTER_FILE}`,
  ]);
  return { previous: `${PLAN_DIR}/${previous}`, diff: result.stdout };
};
