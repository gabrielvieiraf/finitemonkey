import { posix } from "node:path";

import { definesName, languageOf } from "../gate/callers/languages.js";

export const PLAN_DIR = "docs/organize";
export const MAX_TARGETS = 3;
export const CHUNK_LINES = 300;
const TOP_LEVEL = /^\S/;

export interface Responsibility {
  readonly names: readonly string[];
  readonly start: number;
  readonly end: number;
  readonly destination: string;
}

export interface PlanInput {
  readonly file: string;
  readonly text: string;
  readonly importerDirs: readonly string[];
}

interface Declaration {
  readonly name: string;
  readonly line: number;
}

const declarations = (file: string, text: string): readonly Declaration[] => {
  const language = languageOf(file);
  if (language === undefined) return [];
  return text.split(/\r?\n/).flatMap((line, index): Declaration[] => {
    if (!TOP_LEVEL.test(line)) return [];
    const name = language.definitions.map((pattern) => pattern.exec(line)?.[1]).find((found) => found !== undefined);
    return name !== undefined && definesName(language, line, name) ? [{ name, line: index + 1 }] : [];
  });
};

const destinationFor = (file: string, first: string): string => {
  const extension = posix.extname(file);
  const stem = posix.basename(file, extension);
  return posix.join(posix.dirname(file), stem, `${first}${extension}`);
};

export const responsibilities = (
  file: string,
  text: string,
  chunk: number = CHUNK_LINES,
): readonly Responsibility[] => {
  const found = declarations(file, text);
  const total = text.replace(/\r?\n$/, "").split(/\r?\n/).length;
  const groups: Declaration[][] = [];
  for (const [index, item] of found.entries()) {
    const current = groups[groups.length - 1];
    const start = current?.[0]?.line ?? item.line;
    const next = found[index + 1]?.line ?? total + 1;
    if (current === undefined || next - start > chunk) groups.push([item]);
    else current.push(item);
  }
  return groups.flatMap((group, index): Responsibility[] => {
    const first = group[0];
    if (first === undefined) return [];
    const end = (groups[index + 1]?.[0]?.line ?? total + 1) - 1;
    return [
      { names: group.map((item) => item.name), start: first.line, end, destination: destinationFor(file, first.name) },
    ];
  });
};

export const planSteps = (input: PlanInput, parts: readonly Responsibility[]): readonly string[] => [
  `Characterization tests for ${input.file}, without changing existing tests`,
  ...parts.map(
    (part) =>
      `Extract lines ${String(part.start)}-${String(part.end)} (${part.names.join(", ")}) to ${part.destination} and re-export from ${input.file}`,
  ),
  ...input.importerDirs.map((dir) => `Migrate the callers in ${dir} to the new modules`),
  `Remove the re-exports from ${input.file} once callers shows zero importers`,
  `Lower the quality ratchet for ${input.file}`,
];

export const planMarkdown = (input: PlanInput, parts: readonly Responsibility[]): string =>
  [
    `# Split plan: ${input.file}`,
    "",
    "## Responsibilities",
    "",
    "| Lines | Declarations | Destination |",
    "| --- | --- | --- |",
    ...parts.map(
      (part) => `| ${String(part.start)}-${String(part.end)} | ${part.names.join(", ")} | ${part.destination} |`,
    ),
    "",
    "## Parity matrix",
    "",
    "Fill in only when a step changes behavior. Moving code does not.",
    "",
    ...planSteps(input, parts).flatMap((step, index) => [`## Step ${String(index + 1)}: ${step}`, ""]),
  ].join("\n");

export const stepsIn = (markdown: string): readonly string[] =>
  markdown
    .split(/\r?\n/)
    .flatMap((line) => /^## Step \d+: (.+)$/.exec(line)?.[1] ?? [])
    .map((goal) => goal.trim());

export const planPath = (file: string): string =>
  posix.join(PLAN_DIR, `${file.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "")}.md`);
