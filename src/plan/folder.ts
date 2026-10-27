import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export const PLAN_DIR = "docs/plan";

const NUMBERED = /^(\d{2,})([a-z]?)-/;

export const planDir = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, ...PLAN_DIR.split("/")));

export const planPath = (root: AbsolutePath, name: string): AbsolutePath => toAbsolutePath(join(planDir(root), name));

export const planFiles = (runtime: Pick<Runtime, "listDir">, root: AbsolutePath): readonly string[] => {
  const listed = runtime.listDir(planDir(root));
  return listed.ok ? [...listed.value].sort() : [];
};

export const numberOf = (name: string): number | undefined => {
  const match = NUMBERED.exec(name);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
};

export const nextNumber = (names: readonly string[]): string => {
  const highest = Math.max(0, ...names.map((name) => numberOf(name) ?? 0));
  return String(highest + 1).padStart(2, "0");
};

export const slugOf = (topic: string): string => {
  const slug = topic
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug === "" ? "topic" : slug;
};

export const findByKind = (names: readonly string[], kind: string, topic: string): string | undefined =>
  names.find((name) => NUMBERED.test(name) && name.endsWith(`-${kind}-${slugOf(topic)}.md`));
