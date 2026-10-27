import { isRecord, type JsonObject } from "../core/parsed.js";
import type { YamlValue } from "../core/yaml/parse.js";

export const REGISTRY_SCHEMA = "finitemonkey/worktrees@1";

export const OWNER_KINDS = ["subagent", "session", "human", "unknown"] as const;

export type OwnerKind = (typeof OWNER_KINDS)[number];

export const WORKTREE_STATUSES = ["active", "done", "merged", "abandoned", "archived", "removed", "adopted"] as const;

export type WorktreeStatus = (typeof WORKTREE_STATUSES)[number];

export interface WorktreeOwner {
  readonly kind: OwnerKind;
  readonly agentId: string | null;
  readonly sessionId: string | null;
}

export interface PortRange {
  readonly from: number;
  readonly to: number;
}

export interface WorktreeEntry {
  readonly id: string;
  readonly path: string;
  readonly branch: string | null;
  readonly baseRef: string | null;
  readonly baseSha: string | null;
  readonly target: string | null;
  readonly owner: WorktreeOwner;
  readonly purpose: string;
  readonly contract: string | null;
  readonly parent: string | null;
  readonly ports: PortRange | null;
  readonly pids: readonly number[];
  readonly createdAt: string;
  readonly activityAt: string;
  readonly status: WorktreeStatus;
  readonly pr: number | null;
  readonly archive: string | null;
}

const text = (record: JsonObject, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
};

const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

const ownerOf = (value: unknown): WorktreeOwner => {
  const record = isRecord(value) ? value : {};
  return {
    kind: oneOf(OWNER_KINDS, record["kind"], "unknown"),
    agentId: text(record, "agent_id"),
    sessionId: text(record, "session_id"),
  };
};

const portsOf = (value: unknown): PortRange | null => {
  if (!isRecord(value)) return null;
  const from = integer(value["from"]);
  const to = integer(value["to"]);
  return from === null || to === null ? null : { from, to };
};

const pidsOf = (value: unknown): readonly number[] =>
  Array.isArray(value) ? value.flatMap((item) => (integer(item) === null ? [] : [Number(item)])) : [];

export const parseEntry = (value: unknown): WorktreeEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const id = text(value, "id");
  const path = text(value, "path");
  if (id === null || path === null) return undefined;
  const base = isRecord(value["base"]) ? value["base"] : {};
  return {
    id,
    path,
    branch: text(value, "branch"),
    baseRef: text(base, "ref"),
    baseSha: text(base, "sha"),
    target: text(value, "target"),
    owner: ownerOf(value["owner"]),
    purpose: text(value, "purpose") ?? "",
    contract: text(value, "contract"),
    parent: text(value, "parent"),
    ports: portsOf(value["ports"]),
    pids: pidsOf(value["pids"]),
    createdAt: text(value, "created_at") ?? "",
    activityAt: text(value, "activity_at") ?? "",
    status: oneOf(WORKTREE_STATUSES, value["status"], "adopted"),
    pr: integer(value["pr"]),
    archive: text(value, "archive"),
  };
};

export const entryYaml = (entry: WorktreeEntry): YamlValue => ({
  id: entry.id,
  path: entry.path,
  branch: entry.branch,
  base: { ref: entry.baseRef, sha: entry.baseSha },
  target: entry.target,
  owner: { kind: entry.owner.kind, agent_id: entry.owner.agentId, session_id: entry.owner.sessionId },
  purpose: entry.purpose,
  contract: entry.contract,
  parent: entry.parent,
  ports: entry.ports === null ? null : { from: entry.ports.from, to: entry.ports.to },
  pids: [...entry.pids],
  created_at: entry.createdAt,
  activity_at: entry.activityAt,
  status: entry.status,
  pr: entry.pr,
  archive: entry.archive,
});
