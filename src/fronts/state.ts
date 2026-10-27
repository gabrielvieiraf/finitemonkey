import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type JsonObject, type Parsed, reject } from "../core/parsed.js";
import { pause } from "../core/pause.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml, type YamlValue } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";

export const FRONTS_FILE = ".finitemonkey/fronts.yml";
export const FRONTS_SCHEMA = "finitemonkey/fronts@1";
export const DEFAULT_MAX_CONCURRENT = 3;

export const FRONT_STATUSES = ["planned", "running", "blocked", "reported", "verified", "merged", "dropped"] as const;

export type FrontStatus = (typeof FRONT_STATUSES)[number];

export interface InboxItem {
  readonly at: string;
  readonly text: string;
}

export interface Front {
  readonly id: string;
  readonly goal: string;
  readonly contract: string | null;
  readonly paths: readonly string[];
  readonly append: readonly string[];
  readonly i18nNs: string | null;
  readonly worktree: string | null;
  readonly path: string | null;
  readonly branch: string | null;
  readonly port: number | null;
  readonly shotsPrefix: string | null;
  readonly issue: number | null;
  readonly agentId: string | null;
  readonly agentKind: string;
  readonly status: FrontStatus;
  readonly blockedBy: readonly string[];
  readonly inbox: readonly InboxItem[];
  readonly lastReport: string | null;
  readonly costUsd: number;
  readonly startedAt: string | null;
}

export interface FrontsState {
  readonly wave: number;
  readonly base: string;
  readonly briefing: string;
  readonly maxConcurrent: number;
  readonly budgetUsd: number | null;
  readonly budgetMinutes: number | null;
  readonly fronts: readonly Front[];
  readonly pending: readonly string[];
}

export const EMPTY_STATE: FrontsState = {
  wave: 0,
  base: "",
  briefing: ".finitemonkey/briefing.md",
  maxConcurrent: DEFAULT_MAX_CONCURRENT,
  budgetUsd: null,
  budgetMinutes: null,
  fronts: [],
  pending: [],
};

const str = (record: JsonObject, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
};

const num = (record: JsonObject, key: string): number | null => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const inboxOf = (value: unknown): readonly InboxItem[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) =>
        isRecord(item) && typeof item["at"] === "string" && typeof item["text"] === "string"
          ? [{ at: item["at"], text: item["text"] }]
          : [],
      )
    : [];

const statusOf = (value: unknown): FrontStatus => FRONT_STATUSES.find((status) => status === value) ?? "planned";

const record = (value: unknown): JsonObject => (isRecord(value) ? value : {});

export const parseFront = (value: unknown): Front | undefined => {
  const item = record(value);
  const id = str(item, "id");
  if (id === null) return undefined;
  const scope = record(item["scope"]);
  const shared = record(scope["shared"]);
  const agent = record(item["agent"]);
  return {
    id,
    goal: str(item, "goal") ?? "",
    contract: str(item, "contract"),
    paths: strings(scope["paths"]),
    append: strings(shared["append"]),
    i18nNs: str(shared, "i18n_ns"),
    worktree: str(item, "worktree"),
    path: str(item, "path"),
    branch: str(item, "branch"),
    port: num(item, "port"),
    shotsPrefix: str(item, "shots_prefix"),
    issue: num(item, "issue"),
    agentId: str(agent, "id"),
    agentKind: str(agent, "kind") ?? "subagent",
    status: statusOf(item["status"]),
    blockedBy: strings(item["blocked_by"]),
    inbox: inboxOf(item["inbox"]),
    lastReport: str(item, "last_report"),
    costUsd: num(item, "cost_usd") ?? 0,
    startedAt: str(item, "started_at"),
  };
};

export const frontYaml = (front: Front): YamlValue => ({
  id: front.id,
  goal: front.goal,
  contract: front.contract,
  scope: { paths: [...front.paths], shared: { i18n_ns: front.i18nNs, append: [...front.append] } },
  worktree: front.worktree,
  path: front.path,
  branch: front.branch,
  port: front.port,
  shots_prefix: front.shotsPrefix,
  issue: front.issue,
  agent: { id: front.agentId, kind: front.agentKind },
  status: front.status,
  blocked_by: [...front.blockedBy],
  inbox: front.inbox.map((item) => ({ at: item.at, text: item.text })),
  last_report: front.lastReport,
  cost_usd: front.costUsd,
  started_at: front.startedAt,
});

export const parseState = (text: string): Parsed<FrontsState> => {
  if (text.trim() === "") return accept(EMPTY_STATE);
  const parsed = parseYaml(text);
  if (!parsed.ok) return reject(`line ${String(parsed.error.line)}: ${parsed.error.message}`);
  const root = record(parsed.value);
  const budget = record(root["budget"]);
  const list = Array.isArray(root["fronts"]) ? root["fronts"] : [];
  return accept({
    wave: num(root, "wave") ?? 0,
    base: str(root, "base") ?? "",
    briefing: str(root, "briefing") ?? EMPTY_STATE.briefing,
    maxConcurrent: num(budget, "max_concurrent") ?? DEFAULT_MAX_CONCURRENT,
    budgetUsd: num(budget, "usd"),
    budgetMinutes: num(budget, "minutes"),
    fronts: list.flatMap((item: unknown) => parseFront(item) ?? []),
    pending: strings(root["pending"]),
  });
};

export const serializeState = (state: FrontsState): string =>
  stringifyYaml({
    schema: FRONTS_SCHEMA,
    wave: state.wave,
    base: state.base,
    briefing: state.briefing,
    budget: { max_concurrent: state.maxConcurrent, usd: state.budgetUsd, minutes: state.budgetMinutes },
    fronts: state.fronts.map(frontYaml),
    pending: [...state.pending],
  });

export const frontsPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, FRONTS_FILE));

export const readFronts = (runtime: Runtime, root: AbsolutePath): Parsed<FrontsState> => {
  const path = frontsPath(root);
  if (runtime.stat(path) === undefined) return accept(EMPTY_STATE);
  const text = runtime.readText(path);
  return text.ok ? parseState(text.value) : reject(text.error);
};

const acquire = (runtime: Runtime, path: AbsolutePath) => {
  for (let attempt = 1; ; attempt += 1) {
    const lock = runtime.lock(path, { staleMs: 15_000, owner: "fronts" });
    if (lock.ok || !/^(locked|EPERM|EACCES|EBUSY)/.test(lock.error) || attempt >= 300) return lock;
    pause(15);
  }
};

export const updateFronts = <T>(
  runtime: Runtime,
  root: AbsolutePath,
  change: (state: FrontsState) => Parsed<{ readonly state: FrontsState; readonly result: T }>,
): Parsed<T> => {
  const path = frontsPath(root);
  runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey")));
  const lock = acquire(runtime, toAbsolutePath(`${path}.lock`));
  if (!lock.ok) return lock;
  try {
    const current = readFronts(runtime, root);
    if (!current.ok) return current;
    const next = change(current.value);
    if (!next.ok) return next;
    if (next.value.state === current.value) return accept(next.value.result);
    const written = runtime.writeAtomic(path, serializeState(next.value.state));
    return written.ok ? accept(next.value.result) : written;
  } finally {
    lock.value();
  }
};

export const withFront = (state: FrontsState, id: string, change: (front: Front) => Front): FrontsState => ({
  ...state,
  fronts: state.fronts.map((front) => (front.id === id ? change(front) : front)),
});

export const runningWriteFronts = (state: FrontsState): readonly Front[] =>
  state.fronts.filter((front) => front.status === "running");
