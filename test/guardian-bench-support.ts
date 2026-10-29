import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { scanChange } from "../src/guardian/scan.js";
import { guardianStatus } from "../src/guardian/status.js";
import { createTranslator } from "../src/i18n/translate.js";
import { readResearchLog, researchState } from "../src/research/log.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, denied, fireHook } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { ROOT } from "./support.js";

export const SCENARIO_DIR = join(ROOT, "bench", "guardian", "scenarios");
export const PERSONAS = ["beginner", "senior"] as const;
export type Persona = (typeof PERSONAS)[number];
export type Level = 0 | 1 | 2 | 3;
export type Outcome = "good" | "bad";
export type Final = "requested" | "redirected";

export interface Scenario {
  readonly id: string;
  readonly category: string;
  readonly expected: Level;
  readonly personRight: boolean;
  readonly reactions: Readonly<Record<Persona, "follow" | "override">>;
  readonly consequences: Readonly<Record<Final, Outcome>>;
  readonly raw: JsonObject;
}

const GUARDIAN_POLICY = [
  "guards:",
  "  reality: active",
  "  assumptions: active",
  "  guardian-reuse: active",
  "  proportionality: active",
  "",
].join("\n");

const levelOf = (value: unknown): Level => (value === 1 || value === 2 || value === 3 ? value : 0);

const text = (record: JsonObject, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value : "";
};

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

export const readScenario = (file: string): Scenario => {
  const parsed = parseJsonObject(readFileSync(join(SCENARIO_DIR, file), "utf8"));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  const raw = parsed.value;
  const reactions = isRecord(raw["reactions"]) ? raw["reactions"] : {};
  const consequences = isRecord(raw["consequences"]) ? raw["consequences"] : {};
  const reaction = (persona: Persona): "follow" | "override" =>
    pick(["follow", "override"], reactions[persona], "follow");
  const outcome = (final: Final): Outcome => pick(["good", "bad"], consequences[final], "bad");
  return {
    id: text(raw, "id"),
    category: text(raw, "category"),
    expected: levelOf(raw["expected"]),
    personRight: raw["personRight"] === true,
    reactions: { beginner: reaction("beginner"), senior: reaction("senior") },
    consequences: { requested: outcome("requested"), redirected: outcome("redirected") },
    raw,
  };
};

export const scenarioFiles = (): readonly string[] =>
  readdirSync(SCENARIO_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

const filesOf = (value: unknown): Readonly<Record<string, string>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

const prepare = (scenario: Scenario): Repo => {
  const contract = text(scenario.raw, "contract");
  const task: Record<string, string> =
    contract === ""
      ? {}
      : {
          ".finitemonkey/tasks/work.yml": contract,
          ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "work", done: [] }),
        };
  const repo = makeRepo({ ".finitemonkey/policy.yml": GUARDIAN_POLICY, ...task, ...filesOf(scenario.raw["files"]) });
  for (const [path, content] of Object.entries(filesOf(scenario.raw["change"]))) repo.write(path, content);
  return repo;
};

const withRoot = (value: unknown, root: string): unknown => {
  if (typeof value === "string") return value.replace("{root}", root);
  if (Array.isArray(value)) return value.map((item: unknown) => withRoot(item, root));
  return isRecord(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withRoot(item, root)]))
    : value;
};

const toolLevel = async (repo: Repo, payload: unknown): Promise<Level> => {
  const outcome = await fireHook(repo, "PreToolUse", isRecord(payload) ? payload : {});
  const shown = contextOf(outcome);
  const review = shown.includes("finitemonkey: criterion") || shown.includes("unverified high-impact assumptions");
  if (denied(outcome) && review) return 3;
  return levelOf(Number(/Reality report, level (\d)/.exec(shown)?.[1] ?? "0"));
};

const researchLevel = (repo: Repo, scenario: Scenario): Level => {
  const spec = isRecord(scenario.raw["research"]) ? scenario.raw["research"] : {};
  const sources = Array.isArray(spec["sources"]) ? spec["sources"] : [];
  const lines = [
    {
      type: "question",
      question: text(spec, "question"),
      decision: text(spec, "decision"),
      unknowns: spec["unknowns"] ?? [],
    },
    ...sources.map((item: unknown) => {
      const [url = "", changed = "nothing"] = Array.isArray(item) ? item.map(String) : [];
      return { type: "source", url, changed };
    }),
  ];
  repo.write(".finitemonkey/research/bench.jsonl", lines.map((line) => JSON.stringify(line)).join("\n"));
  const log = readResearchLog(repoRuntime(), fmPaths(repo.root), "bench");
  return log !== undefined && researchState(log).suggestStop ? 1 : 0;
};

export const observe = async (scenario: Scenario): Promise<{ readonly level: Level; readonly evidence: boolean }> => {
  const repo = prepare(scenario);
  try {
    const probe = isRecord(scenario.raw["probe"]) ? scenario.raw["probe"] : {};
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    switch (text(probe, "kind")) {
      case "tool":
        return { level: await toolLevel(repo, withRoot(probe["payload"], repo.root)), evidence: true };
      case "scan": {
        const reports = scanChange(runtime, createTranslator("en"), paths, "HEAD").reports;
        const top = Math.max(0, ...reports.map((item) => item.report.level));
        return { level: levelOf(top), evidence: reports.every((item) => item.report.evidence.length > 0) };
      }
      case "status":
        return { level: guardianStatus(runtime, paths).signals.length > 0 ? 1 : 0, evidence: true };
      case "research":
        return { level: researchLevel(repo, scenario), evidence: true };
      default:
        throw new Error(`${scenario.id}: unknown probe`);
    }
  } finally {
    repo.cleanup();
  }
};
