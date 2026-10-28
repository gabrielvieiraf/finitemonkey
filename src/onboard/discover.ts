import { isRecord, parseJsonObject } from "../core/parsed.js";
import { detectPython, pythonChecks } from "../python/detect.js";
import { packageManager, type ProjectFiles } from "../task/implicit.js";
import type { Purpose } from "./purpose.js";

export interface Candidate {
  readonly purpose: Purpose;
  readonly run: string;
  readonly source: string;
}

const SCRIPT_PURPOSE: readonly (readonly [string, Purpose])[] = [
  ["build", "build"],
  ["typecheck", "typecheck"],
  ["type-check", "typecheck"],
  ["tsc", "typecheck"],
  ["lint", "lint"],
  ["format:check", "format"],
  ["test", "test"],
];

const DRAFT = /`((?:npm|pnpm|yarn|bun|npx|make|uv|python3?|pytest|go|cargo|ruff|tsc)\b[^`\n]*)`/g;
const DRAFT_FILES = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"] as const;

const purposeOf = (run: string): Purpose => {
  if (/\btest|pytest\b/.test(run)) return "test";
  if (/\b(?:tsc|typecheck|type-check|mypy|pyright)\b/.test(run)) return "typecheck";
  if (/\b(?:lint|ruff check|clippy|vet)\b/.test(run)) return "lint";
  if (/\b(?:format|fmt|prettier)\b/.test(run)) return "format";
  return /\bbuild\b/.test(run) ? "build" : "check";
};

const fromPackage = (files: ProjectFiles): readonly Candidate[] => {
  const text = files.read("package.json");
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  const scripts = parsed?.ok === true ? parsed.value["scripts"] : undefined;
  if (!isRecord(scripts)) return [];
  const pm = packageManager(files);
  return SCRIPT_PURPOSE.flatMap(([name, purpose]): Candidate[] => {
    const body = scripts[name];
    if (typeof body !== "string" || body.includes("no test specified")) return [];
    return [{ purpose, run: `${pm} run ${name}`, source: "package.json" }];
  });
};

const fromMakefile = (files: ProjectFiles): readonly Candidate[] => {
  const text = files.read("Makefile") ?? "";
  return ["build", "lint", "test", "check"].flatMap((target): Candidate[] =>
    new RegExp(`^${target}:`, "m").test(text)
      ? [{ purpose: purposeOf(target), run: `make ${target}`, source: "Makefile" }]
      : [],
  );
};

const STACKS: readonly (readonly [string, readonly (readonly [Purpose, string])[]])[] = [
  [
    "go.mod",
    [
      ["build", "go build ./..."],
      ["lint", "go vet ./..."],
      ["test", "go test ./..."],
    ],
  ],
  [
    "Cargo.toml",
    [
      ["build", "cargo build"],
      ["lint", "cargo clippy"],
      ["test", "cargo test"],
    ],
  ],
];

const fromPython = (files: ProjectFiles): readonly Candidate[] => {
  const python = detectPython(files.read, files.exists);
  if (python === undefined) return [];
  return pythonChecks(python).flatMap((check) =>
    check.run === undefined ? [] : [{ purpose: purposeOf(check.run), run: check.run, source: "pyproject.toml" }],
  );
};

const fromStacks = (files: ProjectFiles): readonly Candidate[] => [
  ...STACKS.flatMap(([file, runs]) =>
    files.exists(file) ? runs.map(([purpose, run]) => ({ purpose, run, source: file })) : [],
  ),
  ...fromPython(files),
];

const fromDrafts = (files: ProjectFiles, own: (text: string) => string): readonly Candidate[] =>
  DRAFT_FILES.flatMap((file) =>
    [...own(files.read(file) ?? "").matchAll(DRAFT)].map((match) => {
      const run = (match[1] ?? "").trim();
      return { purpose: purposeOf(run), run, source: file };
    }),
  );

export const discoverCommands = (files: ProjectFiles, own: (text: string) => string): readonly Candidate[] => {
  const all = [...fromPackage(files), ...fromMakefile(files), ...fromStacks(files), ...fromDrafts(files, own)];
  const seen = new Set<string>();
  return all.filter((candidate) => {
    if (seen.has(candidate.run)) return false;
    seen.add(candidate.run);
    return true;
  });
};
