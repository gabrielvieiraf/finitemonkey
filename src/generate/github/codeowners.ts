import type { GenFile } from "../files.js";

export const CODEOWNERS_FILE = ".github/CODEOWNERS";
export const CODEOWNERS_PLACES = [CODEOWNERS_FILE, "CODEOWNERS", "docs/CODEOWNERS"] as const;

const CONTRACT_DIRS = ["src/api", "api", "contract", "contracts", "openapi", "proto"] as const;
const MIGRATION_DIRS = [
  "prisma/migrations",
  "migrations",
  "db/migrations",
  "supabase/migrations",
  "alembic/versions",
  "drizzle",
] as const;
const ALWAYS = ["/.github/workflows/", "/infra/"] as const;

export interface CodeownersInput {
  readonly owner: string;
  readonly dirs: (candidates: readonly string[]) => readonly string[];
  readonly exists: (path: string) => boolean;
}

export const ownedPaths = (dirs: CodeownersInput["dirs"]): readonly string[] => [
  ...dirs(CONTRACT_DIRS).map((dir) => `/${dir}/`),
  ...ALWAYS,
  ...dirs(MIGRATION_DIRS).map((dir) => `/${dir}/`),
];

export const codeownersText = (owner: string, paths: readonly string[], self: string): string => {
  const width = Math.max(...[...paths, `/${self}`].map((path) => path.length)) + 1;
  return [...paths, `/${self}`]
    .map((path) => `${path.padEnd(width)}${owner}`)
    .join("\n")
    .concat("\n");
};

export const codeownersFile = (input: CodeownersInput): GenFile => {
  const path = CODEOWNERS_PLACES.find(input.exists) ?? CODEOWNERS_FILE;
  return { path, text: codeownersText(input.owner, ownedPaths(input.dirs), path) };
};

const REMOTE = /github\.com[:/]([^/\s]+)\/[^/\s]+?(?:\.git)?\s*$/;

export const ownerFromRemote = (url: string): string | undefined => {
  const match = REMOTE.exec(url.trim());
  return match?.[1] === undefined ? undefined : `@${match[1]}`;
};
