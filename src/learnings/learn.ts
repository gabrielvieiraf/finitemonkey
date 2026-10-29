import type { HookInput } from "../hooks/handlers.js";
import { untrustedIn } from "../policy/untrusted.js";
import { readEntries, type SignalEntry, signalFiles } from "../signals/store.js";
import type { FmPaths } from "../task/paths.js";
import { type Lesson, newLesson, readLessons, writeLessons } from "./store.js";

export const MIN_REPEATS = 2;
const MAX_FILES = 3;

type Of<K extends SignalEntry["kind"]> = Extract<SignalEntry, { readonly kind: K }>;

export interface FixedSignature {
  readonly sig: string;
  readonly sample: string;
  readonly files: readonly string[];
}

export const fixedSignatures = (entries: readonly SignalEntry[]): readonly FixedSignature[] => {
  const errors = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    if (entry.kind === "error") errors.set(entry.sig, [...(errors.get(entry.sig) ?? []), index]);
  });
  return [...errors].flatMap(([sig, positions]): readonly FixedSignature[] => {
    const last = positions.at(-1);
    if (last === undefined || positions.length < MIN_REPEATS) return [];
    const after = entries.slice(last + 1);
    const firstEdit = after.findIndex((entry) => entry.kind === "edit");
    if (firstEdit < 0 || firstEdit === after.length - 1) return [];
    const files = [
      ...new Set(after.filter((entry): entry is Of<"edit"> => entry.kind === "edit").map((entry) => entry.file)),
    ].slice(0, MAX_FILES);
    const lastEntry = entries[last];
    const sample = lastEntry?.kind === "error" ? lastEntry.sample : "";
    return [{ sig, sample, files }];
  });
};

export const learnFromSignatures = (input: HookInput, paths: FmPaths): readonly Lesson[] => {
  const session = input.payload.sessionId ?? "";
  const entries = readEntries(input.runtime, signalFiles(paths)).filter((entry) => entry.session === session);
  const lessons = readLessons(input.runtime, paths.dir);
  const now = input.runtime.now();
  const untrusted = untrustedIn(input.runtime, paths, session);
  const added = fixedSignatures(entries)
    .filter((fixed) => !lessons.some((lesson) => lesson.sig === fixed.sig))
    .map((fixed) =>
      newLesson(
        {
          text: input.t("learnings.from_signature", { sample: fixed.sample, files: fixed.files.join(", ") }),
          paths: fixed.files,
          sig: fixed.sig,
          source: "signature",
          origin: untrusted === undefined ? "tool output" : `tool output after ${untrusted}`,
          quarantined: untrusted !== undefined,
        },
        now,
      ),
    );
  if (added.length > 0) writeLessons(input.runtime, paths.dir, [...lessons, ...added]);
  return added;
};
