import { dirname } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { type Lesson, newLesson, readLessons, writeLessons } from "./store.js";

export const AGENT_CHANGES_FILE = "agent-changes.json";
export const REPEATS_TO_LEARN = 2;
const MAX_PENDING = 50;
const MAX_REVERTS = 200;
const SNIPPET = 80;

export interface AgentChange {
  readonly key: string;
  readonly file: string;
  readonly before: string;
  readonly after: string;
}

interface Changes {
  readonly pending: readonly AgentChange[];
  readonly reverts: readonly AgentChange[];
}

type FileRuntime = Pick<Runtime, "readText" | "writeText" | "mkdir">;

const changeOf = (value: unknown): AgentChange | undefined => {
  if (!isRecord(value)) return undefined;
  const { key, file, before, after } = value;
  return typeof key === "string" && typeof file === "string" && typeof before === "string" && typeof after === "string"
    ? { key, file, before, after }
    : undefined;
};

const listOf = (value: unknown): readonly AgentChange[] =>
  Array.isArray(value) ? value.flatMap((item) => changeOf(item) ?? []) : [];

const readChanges = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Changes => {
  const raw = readJsonFile(runtime, paths.cache(AGENT_CHANGES_FILE));
  return { pending: listOf(raw?.["pending"]), reverts: listOf(raw?.["reverts"]) };
};

const writeChanges = (runtime: FileRuntime, paths: FmPaths, changes: Changes): void => {
  runtime.mkdir(toAbsolutePath(dirname(paths.cache(AGENT_CHANGES_FILE))));
  writeJsonFile(runtime, paths.cache(AGENT_CHANGES_FILE), {
    pending: changes.pending.slice(-MAX_PENDING).map((item) => ({ ...item })),
    reverts: changes.reverts.slice(-MAX_REVERTS).map((item) => ({ ...item })),
  });
};

export const changeKey = (file: string, before: string, after: string): string =>
  sha256Hex(`${file}\u0000${before}\u0000${after}`).slice(0, 12);

export const noteAgentEdits = (
  runtime: FileRuntime,
  paths: FmPaths,
  file: string,
  edits: readonly { readonly oldText: string; readonly newText: string }[],
): void => {
  const kept = edits.filter((edit) => edit.oldText.trim() !== "" && edit.newText.trim() !== "");
  if (kept.length === 0) return;
  const current = readChanges(runtime, paths);
  const undone = (item: AgentChange): boolean =>
    item.file === file && kept.some((edit) => edit.oldText === item.after && edit.newText === item.before);
  const added = kept
    .filter((edit) => edit.oldText !== edit.newText)
    .map((edit) => ({
      key: changeKey(file, edit.oldText, edit.newText),
      file,
      before: edit.oldText,
      after: edit.newText,
    }));
  writeChanges(runtime, paths, {
    pending: [
      ...current.pending.filter((item) => !undone(item) && !added.some((next) => next.key === item.key)),
      ...added,
    ],
    reverts: current.reverts,
  });
};

export const forgetAgentFile = (runtime: FileRuntime, paths: FmPaths, file: string): void => {
  const current = readChanges(runtime, paths);
  if (!current.pending.some((item) => item.file === file)) return;
  writeChanges(runtime, paths, {
    pending: current.pending.filter((item) => item.file !== file),
    reverts: current.reverts,
  });
};

const stateOf = (text: string | undefined, change: AgentChange): "reverted" | "kept" | "gone" => {
  if (text === undefined) return "gone";
  if (text.includes(change.after)) return "kept";
  return text.includes(change.before) ? "reverted" : "gone";
};

const snippet = (text: string): string => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > SNIPPET ? `${line.slice(0, SNIPPET)}...` : line;
};

export const lessonFor = (t: Translate, change: AgentChange, now: string): Lesson =>
  newLesson(
    {
      text: t("learnings.from_revert", {
        file: change.file,
        before: snippet(change.before),
        after: snippet(change.after),
      }),
      paths: [change.file],
      sig: `revert:${change.key}`,
      source: "correction",
      origin: "person",
      quarantined: true,
    },
    now,
  );

export const scanReverts = (
  runtime: FileRuntime & Pick<Runtime, "now">,
  paths: FmPaths,
  t: Translate,
  read: (file: string) => string | undefined,
): readonly Lesson[] => {
  const current = readChanges(runtime, paths);
  if (current.pending.length === 0) return [];
  const states = current.pending.map((change) => ({ change, state: stateOf(read(change.file), change) }));
  const reverted = states.filter((item) => item.state === "reverted").map((item) => item.change);
  const reverts = [...current.reverts, ...reverted];
  writeChanges(runtime, paths, {
    pending: states.filter((item) => item.state === "kept").map((item) => item.change),
    reverts,
  });
  const lessons = readLessons(runtime, paths.dir);
  const added = [...new Set(reverted.map((change) => change.key))].flatMap((key) => {
    const change = reverted.find((item) => item.key === key);
    const count = reverts.filter((item) => item.key === key).length;
    if (change === undefined || count < REPEATS_TO_LEARN) return [];
    return lessons.some((lesson) => lesson.sig === `revert:${key}`) ? [] : [lessonFor(t, change, runtime.now())];
  });
  if (added.length > 0) writeLessons(runtime, paths.dir, [...lessons, ...added]);
  return added;
};
