import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";

export const PARKING_FILE = "parking.jsonl";

export interface ParkedIdea {
  readonly id: string;
  readonly task: string | null;
  readonly text: string;
  readonly at: string;
  readonly status: "parked" | "unparked";
}

export const parkingPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, PARKING_FILE));

const ideaOf = (value: unknown): ParkedIdea | undefined => {
  if (!isRecord(value)) return undefined;
  const { id, task, text, at, status } = value;
  if (typeof id !== "string" || typeof text !== "string" || typeof at !== "string") return undefined;
  return {
    id,
    task: typeof task === "string" ? task : null,
    text,
    at,
    status: status === "unparked" ? "unparked" : "parked",
  };
};

export const readParking = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ParkedIdea[] => {
  const content = runtime.readText(parkingPath(paths));
  if (!content.ok) return [];
  const latest = new Map<string, ParkedIdea>();
  for (const line of content.value.split("\n")) {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const idea = parsed?.ok === true ? ideaOf(parsed.value) : undefined;
    if (idea !== undefined) latest.set(idea.id, idea);
  }
  return [...latest.values()];
};

const appendIdea = (runtime: Pick<Runtime, "appendText" | "mkdir">, paths: FmPaths, idea: ParkedIdea): boolean =>
  runtime.mkdir(paths.dir).ok && runtime.appendText(parkingPath(paths), `${JSON.stringify(idea)}\n`).ok;

export const park = (
  runtime: Pick<Runtime, "readText" | "appendText" | "mkdir" | "now">,
  paths: FmPaths,
  task: string | undefined,
  text: string,
): ParkedIdea | undefined => {
  const id = `p${String(readParking(runtime, paths).length + 1)}`;
  const idea: ParkedIdea = { id, task: task ?? null, text, at: runtime.now(), status: "parked" };
  return appendIdea(runtime, paths, idea) ? idea : undefined;
};

export const unpark = (
  runtime: Pick<Runtime, "readText" | "appendText" | "mkdir" | "now">,
  paths: FmPaths,
  id: string,
): ParkedIdea | undefined => {
  const found = readParking(runtime, paths).find((idea) => idea.id === id && idea.status === "parked");
  if (found === undefined) return undefined;
  const idea: ParkedIdea = { ...found, status: "unparked", at: runtime.now() };
  return appendIdea(runtime, paths, idea) ? idea : undefined;
};
