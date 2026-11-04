import { isAbsolute } from "node:path";

import type { HookInput } from "../hooks/handlers.js";
import { trialFor } from "../policy/evolved.js";
import { loadBasePolicy } from "../policy/policy.js";
import { untrustedIn } from "../policy/untrusted.js";
import { SHELL_TOOLS } from "../signals/record.js";
import { readEntries, type SignalEntry, signalFiles } from "../signals/store.js";
import type { FmPaths } from "../task/paths.js";
import { clipWords, type Lesson, MAX_TEXT, newLesson, readLessons, writeLessons } from "./store.js";
import { stampTree } from "./tree.js";

export const MIN_REPEATS = 2;
const MAX_FILES = 3;

type Of<K extends SignalEntry["kind"]> = Extract<SignalEntry, { readonly kind: K }>;

export interface FixedSignature {
  readonly sig: string;
  readonly sample: string;
  readonly files: readonly string[];
}

const insideProject = (file: string): boolean => file !== "" && !file.startsWith("../") && !isAbsolute(file);

const fixableByEdit = (entry: SignalEntry): entry is Of<"error"> =>
  entry.kind === "error" && SHELL_TOOLS.has(entry.tool);

export const fixedSignatures = (entries: readonly SignalEntry[]): readonly FixedSignature[] => {
  const errors = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    if (fixableByEdit(entry)) errors.set(entry.sig, [...(errors.get(entry.sig) ?? []), index]);
  });
  return [...errors].flatMap(([sig, positions]): readonly FixedSignature[] => {
    const last = positions.at(-1);
    if (last === undefined || positions.length < MIN_REPEATS) return [];
    const after = entries.slice(last + 1);
    const isOwnEdit = (entry: SignalEntry): entry is Of<"edit"> => entry.kind === "edit" && insideProject(entry.file);
    const firstEdit = after.findIndex(isOwnEdit);
    if (firstEdit < 0 || firstEdit === after.length - 1) return [];
    const files = [...new Set(after.filter(isOwnEdit).map((entry) => entry.file))].slice(0, MAX_FILES);
    const lastEntry = entries[last];
    const sample = lastEntry?.kind === "error" ? lastEntry.sample : "";
    return [{ sig, sample, files }];
  });
};

const lessonText = (input: HookInput, fixed: FixedSignature): string => {
  const files = fixed.files.join(", ");
  const room = MAX_TEXT - input.t("learnings.from_signature", { sample: "", files }).length;
  return input.t("learnings.from_signature", { sample: clipWords(fixed.sample, Math.max(room, 1)), files });
};

export const learnFromSignatures = (input: HookInput, paths: FmPaths): readonly Lesson[] => {
  const session = input.payload.sessionId ?? "";
  const entries = readEntries(input.runtime, signalFiles(paths)).filter((entry) => entry.session === session);
  const lessons = readLessons(input.runtime, paths.dir);
  const now = input.runtime.now();
  const untrusted = untrustedIn(input.runtime, paths, session);
  const variant = trialFor(input.runtime, paths.root, loadBasePolicy(input.runtime, paths.root));
  const origin =
    untrusted === undefined
      ? variant === undefined
        ? "tool output"
        : `tool output under policy variant ${variant.id}`
      : `tool output after ${untrusted}`;
  const added = fixedSignatures(entries)
    .filter((fixed) => !lessons.some((lesson) => lesson.sig === fixed.sig))
    .map((fixed) =>
      stampTree(
        input.runtime,
        paths.root,
        newLesson(
          {
            text: lessonText(input, fixed),
            paths: fixed.files,
            sig: fixed.sig,
            source: "signature",
            origin,
            quarantined: untrusted !== undefined || variant !== undefined,
          },
          now,
        ),
      ),
    );
  if (added.length > 0) writeLessons(input.runtime, paths.dir, [...lessons, ...added]);
  return added;
};
