import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { catalogs } from "../i18n/catalogs.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";
import { readFront } from "../plan/front.js";
import { matchesHeading, type Section, sectionsOf } from "../plan/sections.js";
import { type TableRow, tableRows } from "../plan/table.js";
import {
  RESEARCH_FILE,
  RESEARCH_SECTIONS,
  researchKey,
  type ResearchSection,
  SOURCE_KINDS,
  type SourceKind,
  STRENGTHS,
} from "./sections.js";

export const RESEARCH_ISSUES = [
  "missing_sections",
  "lists_not_on_top",
  "source_without_url",
  "source_without_date",
  "unknown_kind",
  "index_without_version",
  "unknown_strength",
  "unknown_source",
  "index_alone_strong",
  "vendor_alone_strong",
  "version_unchecked",
  "no_primary",
] as const;

export type ResearchIssueKind = (typeof RESEARCH_ISSUES)[number];

export interface ResearchIssue {
  readonly kind: ResearchIssueKind;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

export interface ResearchRecord {
  readonly file: string;
  readonly text: string;
  readonly kinds: ReadonlyMap<string, SourceKind>;
  readonly issues: readonly ResearchIssue[];
}

type Issue = Omit<ResearchIssue, "file">;

const DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const URL = /https?:\/\/\S+/;

const idOf = (section: Section): ResearchSection | undefined =>
  RESEARCH_SECTIONS.find((id) => matchesHeading(section.heading, researchKey(id)));

const rowsIn = (sections: readonly Section[], id: ResearchSection): readonly TableRow[] =>
  tableRows(sections.find((section) => idOf(section) === id)?.lines ?? []);

const structure = (sections: readonly Section[]): readonly Issue[] => {
  const ids = sections.flatMap((section) => idOf(section) ?? []);
  const missing = RESEARCH_SECTIONS.filter((id) => !ids.includes(id));
  const top = ids[0] === "not_read" && ids[1] === "not_verified";
  return [
    ...(missing.length === 0
      ? []
      : [
          {
            kind: "missing_sections" as const,
            line: 1,
            detail: missing.map((id) => catalogs.en[researchKey(id)]).join(", "),
          },
        ]),
    ...(top || missing.includes("not_read") || missing.includes("not_verified")
      ? []
      : [{ kind: "lists_not_on_top" as const, line: sections[0]?.line ?? 1, detail: ids.join(", ") }]),
  ];
};

const sourceIssues = (rows: readonly TableRow[]): readonly Issue[] =>
  rows.flatMap(({ cells, line }) => {
    const [id = "", , url = "", accessed = "", kind = "", version = ""] = cells;
    const known = SOURCE_KINDS.find((item) => item === kind.toLowerCase());
    return [
      ...(URL.test(url) ? [] : [{ kind: "source_without_url" as const, line, detail: id }]),
      ...(DATE.test(accessed) ? [] : [{ kind: "source_without_date" as const, line, detail: id }]),
      ...(known === undefined ? [{ kind: "unknown_kind" as const, line, detail: `${id}: ${kind}` }] : []),
      ...(known === "index" && version === "" ? [{ kind: "index_without_version" as const, line, detail: id }] : []),
    ];
  });

const kindsOf = (rows: readonly TableRow[]): ReadonlyMap<string, SourceKind> =>
  new Map(
    rows.flatMap(({ cells }) => {
      const kind = SOURCE_KINDS.find((item) => item === (cells[4] ?? "").toLowerCase());
      return kind === undefined ? [] : [[(cells[0] ?? "").toUpperCase(), kind] as const];
    }),
  );

const findingIssues = (rows: readonly TableRow[], kinds: ReadonlyMap<string, SourceKind>): readonly Issue[] =>
  rows.flatMap(({ cells, line }) => {
    const [finding = "", strength = "", cited = ""] = cells;
    const ids = cited
      .split(/[,\s]+/)
      .map((id) => id.toUpperCase())
      .filter((id) => id !== "");
    const unknown = ids.filter((id) => !kinds.has(id));
    const backing = ids.flatMap((id) => kinds.get(id) ?? []);
    const strong = strength.toLowerCase() === "strong";
    const alone = (kind: SourceKind): boolean => strong && backing.length > 0 && backing.every((item) => item === kind);
    return [
      ...(STRENGTHS.some((item) => item === strength.toLowerCase())
        ? []
        : [{ kind: "unknown_strength" as const, line, detail: `${finding}: ${strength}` }]),
      ...(ids.length === 0 || unknown.length > 0
        ? [{ kind: "unknown_source" as const, line, detail: `${finding}: ${unknown.join(", ") || "-"}` }]
        : []),
      ...(alone("index") ? [{ kind: "index_alone_strong" as const, line, detail: finding }] : []),
      ...(alone("vendor") ? [{ kind: "vendor_alone_strong" as const, line, detail: finding }] : []),
    ];
  });

const versionIssues = (rows: readonly TableRow[]): readonly Issue[] =>
  rows.flatMap(({ cells, line }) => {
    const [name = "", version = "", checkedIn = "", date = ""] = cells;
    return version === "" || checkedIn === "" || !DATE.test(date)
      ? [{ kind: "version_unchecked" as const, line, detail: name }]
      : [];
  });

export const readResearch = (file: string, text: string): ResearchRecord => {
  const { body } = readFront(text);
  const offset = text.replace(/\r\n/g, "\n").split("\n").length - body.split("\n").length;
  const sections = sectionsOf(body, offset);
  const sources = rowsIn(sections, "sources");
  const kinds = kindsOf(sources);
  const primary = [...kinds.values()].includes("primary");
  const issues: readonly Issue[] = [
    ...structure(sections),
    ...sourceIssues(sources),
    ...findingIssues(rowsIn(sections, "findings"), kinds),
    ...versionIssues(rowsIn(sections, "versions")),
    ...(primary ? [] : [{ kind: "no_primary" as const, line: 1, detail: file }]),
  ];
  return { file, text, kinds, issues: issues.map((item) => ({ ...item, file })) };
};

export const researchRecords = (runtime: Runtime, root: AbsolutePath, only?: string): readonly ResearchRecord[] =>
  planFiles(runtime, root)
    .filter((name) => RESEARCH_FILE.test(name) && (only === undefined || name === only))
    .flatMap((name) => {
      const text = runtime.readText(planPath(root, name));
      return text.ok ? [readResearch(`${PLAN_DIR}/${name}`, text.value)] : [];
    });
