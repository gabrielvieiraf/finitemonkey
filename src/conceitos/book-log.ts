import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { appendEntry, entryId } from "../judge/store.js";
import { BOOK_LEVEL_REF, type EvidenceOrigin } from "../judge/types.js";
import type { FmPaths } from "../task/paths.js";
import { type Book, bookConcepts, LEVEL_PREFIX } from "./book.js";
import { rankOf } from "./concepts.js";

export const levelRecords = (before: Book, after: Book, origin: EvidenceOrigin, now: string): readonly JsonObject[] =>
  bookConcepts(after).flatMap((id) => {
    const entry = after.concepts[id];
    if (entry === undefined || rankOf(entry.level) <= rankOf(before.concepts[id]?.level)) return [];
    const at = entry.updatedAt === "" ? now : entry.updatedAt;
    return [
      {
        type: "evidence",
        id: entryId("b", id, entry.level, at),
        at,
        concepts: [id],
        proof: "exposure",
        result: "pass",
        ref: BOOK_LEVEL_REF,
        origin,
        source: `${LEVEL_PREFIX}${entry.level}`,
      },
    ];
  });

export const recordLevels = (
  runtime: Pick<Runtime, "appendText" | "mkdir" | "now">,
  paths: FmPaths,
  change: { readonly before: Book; readonly after: Book },
  origin: EvidenceOrigin,
): number =>
  levelRecords(change.before, change.after, origin, runtime.now()).filter(
    (record) => appendEntry(runtime, paths, record).ok,
  ).length;
