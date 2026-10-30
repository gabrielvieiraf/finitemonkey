import { dirname } from "node:path";

import { readPrompts } from "../audit/log.js";
import { toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { loadPolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { type Claim, readClaims } from "./claims.js";
import { trackedFiles, viewsOf } from "./service.js";

export const KNOWLEDGE_MAP_FEATURE = "knowledge-map";
export const QUESTIONS_FILE = "questions.json";
export const SESSION_TAIL_MS = 30 * 60_000;
export const LOOKBACK_DAYS = 180;

export const HOLDERS = ["person", "claims", "agent", "nobody"] as const;

export type Holder = (typeof HOLDERS)[number];

export interface AreaKnowledge {
  readonly area: string;
  readonly holder: Holder;
  readonly personCommits: number;
  readonly agentCommits: number;
  readonly checkedClaims: number;
}

export const areaOf = (path: string): string => {
  const parts = path.split("/").filter((part) => part !== "");
  return parts.length <= 1 ? "." : parts.slice(0, Math.min(2, parts.length - 1)).join("/");
};

export const optedIn = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): boolean => {
  const policy = loadPolicy(runtime, paths.root);
  return (policy.guards[KNOWLEDGE_MAP_FEATURE] ?? policy.userGuards[KNOWLEDGE_MAP_FEATURE]) === "active";
};

interface Window {
  readonly from: number;
  readonly to: number;
}

const sessionWindows = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Window[] => {
  const bySession = new Map<string, number[]>();
  for (const prompt of readPrompts(runtime, paths)) {
    const at = Date.parse(prompt.at);
    if (Number.isFinite(at)) bySession.set(prompt.session, [...(bySession.get(prompt.session) ?? []), at]);
  }
  return [...bySession.values()].map((times) => ({
    from: Math.min(...times),
    to: Math.max(...times) + SESSION_TAIL_MS,
  }));
};

interface Commit {
  readonly at: number;
  readonly files: readonly string[];
}

const SEPARATOR = "\u001e";

const commits = (runtime: Pick<Runtime, "exec">, paths: FmPaths): readonly Commit[] => {
  const out =
    gitAt(runtime, paths.root).out([
      "log",
      `--since=${String(LOOKBACK_DAYS)}.days`,
      `--format=${SEPARATOR}%cI`,
      "--name-only",
    ]) ?? "";
  return out
    .split(SEPARATOR)
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const [date = "", ...files] = chunk.split("\n");
      return { at: Date.parse(date.trim()), files: files.map((file) => file.trim()).filter((file) => file !== "") };
    });
};

const holderOf = (person: number, agent: number, claims: number): Holder => {
  if (person > 0) return "person";
  if (claims > 0) return "claims";
  return agent > 0 ? "agent" : "nobody";
};

export const knowledgeMap = (
  runtime: Pick<Runtime, "readText" | "exec" | "homeDir" | "listDir">,
  paths: FmPaths,
): readonly AreaKnowledge[] => {
  const windows = sessionWindows(runtime, paths);
  const inSession = (at: number): boolean => windows.some((window) => at >= window.from && at <= window.to);
  const counts = new Map<string, { person: number; agent: number; claims: number }>();
  const bump = (area: string, key: "person" | "agent" | "claims"): void => {
    const current = counts.get(area) ?? { person: 0, agent: 0, claims: 0 };
    counts.set(area, { ...current, [key]: current[key] + 1 });
  };
  for (const file of trackedFiles(runtime, paths).filter((path) => !path.startsWith(".finitemonkey/")))
    counts.set(areaOf(file), counts.get(areaOf(file)) ?? { person: 0, agent: 0, claims: 0 });
  for (const commit of commits(runtime, paths))
    for (const area of new Set(commit.files.map(areaOf)))
      if (counts.has(area)) bump(area, inSession(commit.at) ? "agent" : "person");
  for (const view of viewsOf(runtime, paths))
    if (view.status === "valid" && view.claim.kind === "check")
      for (const area of new Set(view.claim.anchors.map((anchor) => areaOf(anchor.path))))
        if (counts.has(area)) bump(area, "claims");
  return [...counts]
    .map(([area, count]) => ({
      area,
      holder: holderOf(count.person, count.agent, count.claims),
      personCommits: count.person,
      agentCommits: count.agent,
      checkedClaims: count.claims,
    }))
    .sort((left, right) => left.area.localeCompare(right.area));
};

export interface SpacedQuestion {
  readonly claim: string;
  readonly text: string;
  readonly anchor: string;
  readonly renewedAt: string;
}

interface QuestionsState {
  readonly asked: readonly string[];
  readonly sessions: readonly string[];
}

const keyOf = (question: Pick<SpacedQuestion, "claim" | "renewedAt">): string =>
  `${question.claim}@${question.renewedAt}`;

const readQuestions = (runtime: Pick<Runtime, "readText">, paths: FmPaths): QuestionsState => {
  const raw = readJsonFile(runtime, paths.cache(QUESTIONS_FILE));
  const list = (key: string): readonly string[] => {
    const value = isRecord(raw) ? raw[key] : undefined;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  return { asked: list("asked"), sessions: list("sessions") };
};

const changedRenewals = (claim: Claim): readonly SpacedQuestion[] => {
  let previous = claim.events[0]?.anchors ?? [];
  const found: SpacedQuestion[] = [];
  for (const event of claim.events) {
    if (event.event !== "renew" || event.anchors === undefined) continue;
    const before = previous.map((anchor) => anchor.hash).join(",");
    const after = event.anchors.map((anchor) => anchor.hash).join(",");
    previous = event.anchors;
    if (before === after) continue;
    const first = event.anchors[0];
    found.push({
      claim: claim.id,
      text: claim.text,
      anchor: first === undefined ? "" : first.symbol === undefined ? first.path : `${first.path}#${first.symbol}`,
      renewedAt: event.recordedAt,
    });
  }
  return found;
};

export const dueQuestions = (
  runtime: Pick<Runtime, "readText" | "exec" | "homeDir" | "listDir">,
  paths: FmPaths,
  personAreas: ReadonlySet<string>,
): readonly SpacedQuestion[] => {
  const asked = new Set(readQuestions(runtime, paths).asked);
  return readClaims(runtime, paths)
    .filter((claim) => claim.anchors.some((anchor) => personAreas.has(areaOf(anchor.path))))
    .flatMap(changedRenewals)
    .filter((question) => !asked.has(keyOf(question)));
};

export const takeQuestion = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  paths: FmPaths,
  session: string,
  due: readonly SpacedQuestion[],
): SpacedQuestion | undefined => {
  const state = readQuestions(runtime, paths);
  const next = due[0];
  if (next === undefined || state.sessions.includes(session)) return undefined;
  runtime.mkdir(toAbsolutePath(dirname(paths.cache(QUESTIONS_FILE))));
  writeJsonFile(runtime, paths.cache(QUESTIONS_FILE), {
    asked: [...state.asked, keyOf(next)],
    sessions: [...state.sessions, session].slice(-50),
  });
  return next;
};

export const MAP_CACHE = "knowledge-map.json";

export const writeMapCache = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  paths: FmPaths,
  areas: readonly AreaKnowledge[],
): void => {
  runtime.mkdir(toAbsolutePath(dirname(paths.cache(MAP_CACHE))));
  writeJsonFile(runtime, paths.cache(MAP_CACHE), {
    person: areas.filter((area) => area.holder === "person").map((area) => area.area),
  });
};

export const cachedPersonAreas = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlySet<string> => {
  const raw = readJsonFile(runtime, paths.cache(MAP_CACHE));
  const list = isRecord(raw) ? raw["person"] : undefined;
  return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
};
