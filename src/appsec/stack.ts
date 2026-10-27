import { isRecord, parseJsonObject } from "../core/parsed.js";

export const FRAMEWORKS = ["nextjs", "vite-react", "express", "fastify", "nestjs", "fastapi", "django"] as const;
export const ORMS = ["prisma", "drizzle", "sqlalchemy"] as const;

export type Framework = (typeof FRAMEWORKS)[number];
export type Orm = (typeof ORMS)[number];

export interface Stack {
  readonly frameworks: readonly Framework[];
  readonly orms: readonly Orm[];
}

type Read = (relative: string) => string | undefined;

const npmDeps = (read: Read): ReadonlySet<string> => {
  const text = read("package.json");
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  if (parsed?.ok !== true) return new Set();
  return new Set(
    ["dependencies", "devDependencies"].flatMap((section) => {
      const value = parsed.value[section];
      return isRecord(value) ? Object.keys(value) : [];
    }),
  );
};

const pythonText = (read: Read): string =>
  ["pyproject.toml", "requirements.txt", "Pipfile"].map((file) => (read(file) ?? "").toLowerCase()).join("\n");

export const detectStack = (read: Read): Stack => {
  const deps = npmDeps(read);
  const python = pythonText(read);
  const has = (name: string): boolean => deps.has(name);
  const py = (name: string): boolean => new RegExp(`(^|[\\s"'\\[])${name}($|[\\s"'=<>~\\[,])`, "m").test(python);
  const frameworks: Framework[] = [];
  if (has("next")) frameworks.push("nextjs");
  if (has("vite") && has("react")) frameworks.push("vite-react");
  if (has("express")) frameworks.push("express");
  if (has("fastify")) frameworks.push("fastify");
  if (has("@nestjs/core")) frameworks.push("nestjs");
  if (py("fastapi")) frameworks.push("fastapi");
  if (py("django")) frameworks.push("django");
  const orms: Orm[] = [];
  if (has("prisma") || has("@prisma/client")) orms.push("prisma");
  if (has("drizzle-orm")) orms.push("drizzle");
  if (py("sqlalchemy")) orms.push("sqlalchemy");
  return { frameworks, orms };
};

export const hasWebStack = (stack: Stack): boolean => stack.frameworks.length > 0 || stack.orms.length > 0;
