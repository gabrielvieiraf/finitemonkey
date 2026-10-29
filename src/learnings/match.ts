import { globToRegExp } from "../core/glob.js";
import { toPosixPath } from "../core/posix-path.js";
import { tokenEstimate } from "../instructions/types.js";
import { dataBlock, hiddenChars } from "../policy/untrusted.js";
import type { Lesson } from "./store.js";

export const DEFAULT_MAX_LESSONS = 2;
export const DEFAULT_MAX_TOKENS = 100;
export const LESSONS_HEADER = "finitemonkey lessons from earlier work in this project:";

export interface LessonKey {
  readonly sig: string | undefined;
  readonly path: string | undefined;
}

export interface LessonLimits {
  readonly maxLessons: number;
  readonly maxTokens: number;
}

export const pathMatches = (lesson: Lesson, path: string | undefined): boolean => {
  if (path === undefined) return false;
  const file = toPosixPath(path);
  return lesson.paths.some((glob) => {
    const pattern = globToRegExp(glob);
    return pattern.test(file) || pattern.test(file.slice(file.lastIndexOf("/") + 1));
  });
};

export const keyMatches = (lesson: Lesson, key: LessonKey): boolean =>
  (key.sig !== undefined && lesson.sig === key.sig) || pathMatches(lesson, key.path);

export const lessonLine = (lesson: Lesson): string => `- ${lesson.text.replace(/\s+/g, " ").trim()}`;

const PROTECTED = [".claude/**", ".finitemonkey/**", ".git/**", ".husky/**", ".githooks/**", "**/settings*.json"];

export const touchesControls = (lesson: Lesson): boolean =>
  lesson.paths.some((glob) => PROTECTED.some((pattern) => globToRegExp(pattern).test(glob.replace(/\*+/g, "x"))));

export const injectable = (lesson: Lesson): boolean =>
  lesson.quarantined !== true && !touchesControls(lesson) && hiddenChars(lesson.text).length === 0;

export const pickLessons = (
  lessons: readonly Lesson[],
  key: LessonKey,
  limits: LessonLimits,
  seen: ReadonlySet<string> = new Set(),
): readonly Lesson[] => {
  const kept: Lesson[] = [];
  let tokens = tokenEstimate(LESSONS_HEADER);
  const ranked = lessons
    .filter((lesson) => injectable(lesson) && keyMatches(lesson, key))
    .filter((lesson) => (key.sig !== undefined && lesson.sig === key.sig) || !seen.has(lesson.id))
    .sort((left, right) => Number(right.sig === key.sig) - Number(left.sig === key.sig) || right.uses - left.uses);
  for (const lesson of ranked) {
    const cost = tokenEstimate(lessonLine(lesson)) + 1;
    if (kept.length >= limits.maxLessons || tokens + cost > limits.maxTokens) continue;
    kept.push(lesson);
    tokens += cost;
  }
  return kept;
};

export const lessonsText = (lessons: readonly Lesson[]): string =>
  [LESSONS_HEADER, dataBlock("finitemonkey lessons (some quote tool output)", lessons.map(lessonLine).join("\n"))].join(
    "\n",
  );
