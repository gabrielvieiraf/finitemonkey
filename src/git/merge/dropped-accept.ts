import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { accept, isRecord, type Parsed, parseJson, reject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { DROPPED_FILE, reasonOf } from "./dropped.js";
import type { Finding } from "./types.js";

export const PERSON_ONLY_REASON = "decisao_humana";

const entryKey = (value: unknown): string =>
  isRecord(value) ? JSON.stringify([value["file"], value["side"] ?? null, value["line"] ?? value["text"] ?? null]) : "";

const existingList = (runtime: Runtime, path: AbsolutePath): Parsed<readonly unknown[]> => {
  const text = runtime.readText(path);
  if (!text.ok) return accept([]);
  const parsed = parseJson(text.value);
  if (!parsed.ok) return reject(`${DROPPED_FILE}: ${parsed.error}`);
  const list = isRecord(parsed.value) ? parsed.value["dropped"] : parsed.value;
  return Array.isArray(list) ? accept(list) : reject(`${DROPPED_FILE}: expected a list of dropped items`);
};

const entryOf = (finding: Finding, reason: string): Record<string, string> => ({
  file: finding.file,
  line: finding.text,
  reason,
  ...(finding.side === undefined ? {} : { side: finding.side }),
});

export const acceptFindings = (
  runtime: Runtime,
  root: AbsolutePath,
  findings: readonly Finding[],
  rawReason: string,
): Parsed<number> => {
  const reason = reasonOf(rawReason);
  if (reason === undefined) return reject(`unknown reason: ${rawReason}`);
  if (reason === PERSON_ONLY_REASON) return reject(`${PERSON_ONLY_REASON} is recorded by the person, by hand`);
  const path = toAbsolutePath(join(root, DROPPED_FILE));
  const list = existingList(runtime, path);
  if (!list.ok) return list;
  const seen = new Set(list.value.map(entryKey));
  const added = findings
    .filter((finding) => finding.kind !== "invalid-dropped")
    .map((finding) => entryOf(finding, reason))
    .filter((entry) => {
      const key = entryKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (added.length === 0) return accept(0);
  const made = runtime.mkdir(toAbsolutePath(dirname(path)));
  if (!made.ok) return made;
  const written = runtime.writeText(path, `${JSON.stringify({ dropped: [...list.value, ...added] }, null, 2)}\n`);
  return written.ok ? accept(added.length) : written;
};
