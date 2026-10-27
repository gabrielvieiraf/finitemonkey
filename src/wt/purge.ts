import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { BACKUP_PREFIX } from "../git/snapshot.js";
import { ARCHIVE_PREFIX } from "./archive.js";

export const DEFAULT_ARCHIVE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface SafetyRef {
  readonly ref: string;
  readonly at: string;
  readonly expired: boolean;
}

export const safetyRefs = (runtime: Runtime, root: AbsolutePath, days: number): readonly SafetyRef[] => {
  const listed = runtime.git(
    ["for-each-ref", "--format=%(refname) %(committerdate:iso-strict)", ARCHIVE_PREFIX, BACKUP_PREFIX],
    root,
  );
  if (!listed.ok) return [];
  const now = Date.parse(runtime.now());
  return listed.stdout.split("\n").flatMap((line) => {
    const [ref = "", at = ""] = line.split(" ");
    if (ref === "") return [];
    const age = now - Date.parse(at);
    return [{ ref, at, expired: Number.isFinite(age) && age > days * DAY_MS }];
  });
};

export const purgeRefs = (runtime: Runtime, root: AbsolutePath, refs: readonly SafetyRef[]): readonly string[] =>
  refs.filter((item) => item.expired && runtime.git(["update-ref", "-d", item.ref], root).ok).map((item) => item.ref);
