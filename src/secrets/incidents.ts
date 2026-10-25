import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "./fingerprint.js";

export const INCIDENTS_DIR = ".finitemonkey/incidents";
export const INCIDENT_STATES = ["aberto", "exposicao-local", "rotacionado", "fechado"] as const;
export const INCIDENT_SOURCES = ["tool-output", "prompt", "history", "scan"] as const;

export type IncidentState = (typeof INCIDENT_STATES)[number];
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export interface IncidentEvent {
  readonly state: IncidentState;
  readonly at: string;
  readonly by: string;
}

export interface Incident {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly rule: string;
  readonly where: string;
  readonly fingerprint: string;
  readonly source: IncidentSource;
  readonly state: IncidentState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly firstCommit?: string;
  readonly history: readonly IncidentEvent[];
}

export interface IncidentDraft {
  readonly rule: string;
  readonly where: string;
  readonly fingerprint: string;
  readonly source: IncidentSource;
  readonly state: Extract<IncidentState, "aberto" | "exposicao-local">;
  readonly firstCommit?: string;
}

const ID = /^inc-[0-9a-f]{12}$/;

export const incidentId = (rule: string, fingerprint: string): string =>
  `inc-${sha256Hex(`${rule}\u0000${fingerprint}`).slice(0, 12)}`;

export const incidentsDir = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, INCIDENTS_DIR));

const incidentFile = (root: AbsolutePath, id: string): AbsolutePath =>
  toAbsolutePath(join(incidentsDir(root), `${id}.json`));

const pick = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find((option) => option === value);

const str = (record: JsonObject, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const parseEvent = (value: unknown): IncidentEvent | undefined => {
  if (!isRecord(value)) return undefined;
  const state = pick(INCIDENT_STATES, value["state"]);
  const at = str(value, "at");
  const by = str(value, "by");
  return state === undefined || at === undefined || by === undefined ? undefined : { state, at, by };
};

const parseHistory = (value: unknown): readonly IncidentEvent[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const events = value.map(parseEvent);
  return events.every((event): event is IncidentEvent => event !== undefined) ? events : undefined;
};

export const parseIncident = (raw: string): Parsed<Incident> => {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const [id, rule, where, fingerprint, createdAt, updatedAt] = (
    ["id", "rule", "where", "fingerprint", "createdAt", "updatedAt"] as const
  ).map((key) => str(record, key));
  const state = pick(INCIDENT_STATES, record["state"]);
  const source = pick(INCIDENT_SOURCES, record["source"]);
  const history = parseHistory(record["history"]);
  const firstCommit = str(record, "firstCommit");
  if (id === undefined || !ID.test(id) || rule === undefined || where === undefined) return reject("incomplete");
  if (fingerprint === undefined || createdAt === undefined || updatedAt === undefined) return reject("incomplete");
  if (state === undefined || source === undefined || history === undefined) return reject("incomplete");
  const base = {
    schemaVersion: 1 as const,
    id,
    rule,
    where,
    fingerprint,
    source,
    state,
    createdAt,
    updatedAt,
    history,
  };
  return accept(firstCommit === undefined ? base : { ...base, firstCommit });
};

export const readIncident = (runtime: Runtime, root: AbsolutePath, id: string): Parsed<Incident> => {
  if (!ID.test(id)) return reject("not an incident id");
  const raw = runtime.readText(incidentFile(root, id));
  return raw.ok ? parseIncident(raw.value) : reject(raw.error);
};

export const listIncidents = (runtime: Runtime, root: AbsolutePath): readonly Incident[] => {
  const names = runtime.listDir(incidentsDir(root));
  if (!names.ok) return [];
  return names.value
    .filter((name) => name.endsWith(".json"))
    .map((name) => readIncident(runtime, root, name.slice(0, -".json".length)))
    .flatMap((parsed) => (parsed.ok ? [parsed.value] : []))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const saveIncident = (runtime: Runtime, root: AbsolutePath, incident: Incident): Parsed<true> => {
  const ignore = runtime.writeText(toAbsolutePath(join(incidentsDir(root), ".gitignore")), "*\n");
  if (!ignore.ok) return ignore;
  return runtime.writeText(incidentFile(root, incident.id), `${JSON.stringify(incident, null, 2)}\n`);
};

const created = (draft: IncidentDraft, now: string, by: string): Incident => ({
  schemaVersion: 1,
  id: incidentId(draft.rule, draft.fingerprint),
  rule: draft.rule,
  where: draft.where,
  fingerprint: draft.fingerprint,
  source: draft.source,
  state: draft.state,
  createdAt: now,
  updatedAt: now,
  ...(draft.firstCommit === undefined ? {} : { firstCommit: draft.firstCommit }),
  history: [{ state: draft.state, at: now, by }],
});

export const recordIncident = (
  runtime: Runtime,
  root: AbsolutePath,
  draft: IncidentDraft,
  by: string,
): Parsed<Incident> => {
  const now = runtime.now();
  const existing = readIncident(runtime, root, incidentId(draft.rule, draft.fingerprint));
  if (existing.ok && existing.value.state !== "fechado") return existing;
  const incident = existing.ok
    ? {
        ...existing.value,
        state: draft.state,
        updatedAt: now,
        history: [...existing.value.history, { state: draft.state, at: now, by }],
      }
    : created(draft, now, by);
  const saved = saveIncident(runtime, root, incident);
  return saved.ok ? accept(incident) : reject(saved.error);
};

const ALLOWED_FROM: Readonly<Record<IncidentState, readonly IncidentState[]>> = {
  aberto: [],
  "exposicao-local": [],
  rotacionado: ["aberto", "exposicao-local"],
  fechado: ["rotacionado"],
};

export const canMove = (from: IncidentState, to: IncidentState): boolean => ALLOWED_FROM[to].includes(from);

export const moveIncident = (incident: Incident, to: IncidentState, now: string, by: string): Incident => ({
  ...incident,
  state: to,
  updatedAt: now,
  history: [...incident.history, { state: to, at: now, by }],
});

export const isRotated = (incident: Incident): boolean =>
  incident.state === "rotacionado" || incident.state === "fechado";
