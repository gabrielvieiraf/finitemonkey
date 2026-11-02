import { createHash } from "node:crypto";
import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { Lesson } from "./store.js";

const GLOB = /[*?[\]{}]/;

const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export const lessonTree = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  paths: readonly string[],
): string | undefined => {
  const files = [...new Set(paths.filter((path) => path !== "" && !GLOB.test(path)))].sort();
  if (files.length === 0) return undefined;
  const lines = files.map((file) => {
    const read = runtime.readText(toAbsolutePath(join(root, file)));
    return `${file}\0${read.ok ? digest(read.value) : "missing"}`;
  });
  return digest(lines.join("\n")).slice(0, 16);
};

const withoutTree = (lesson: Lesson): Lesson => {
  const { origin, quarantined } = lesson;
  return {
    id: lesson.id,
    text: lesson.text,
    paths: lesson.paths,
    sig: lesson.sig,
    source: lesson.source,
    createdAt: lesson.createdAt,
    lastMatchedAt: lesson.lastMatchedAt,
    uses: lesson.uses,
    unhelpful: lesson.unhelpful,
    ...(origin === undefined ? {} : { origin }),
    ...(quarantined === undefined ? {} : { quarantined }),
  };
};

export const stampTree = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, lesson: Lesson): Lesson => {
  const tree = lessonTree(runtime, root, lesson.paths);
  const rest = withoutTree(lesson);
  return tree === undefined ? rest : { ...rest, tree };
};

export const treeChanged = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, lesson: Lesson): boolean =>
  lesson.tree !== undefined && lessonTree(runtime, root, lesson.paths) !== lesson.tree;
