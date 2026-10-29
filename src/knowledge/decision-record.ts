import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { GATE_CHECK } from "../evidence/types.js";
import { changedFiles, fileAt, gitAt, resolveBase } from "../gate/git.js";
import type { DecisionEntry } from "../guardian/decisions.js";
import { commitsSince, type Outcome, outcomeOf } from "../guardian/outcomes.js";
import { featureMode } from "../policy/feature.js";
import { readResearchLog } from "../research/log.js";
import { parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readTrust } from "../task/state.js";

export const DECISION_RECORD_FEATURE = "decision-record";
export const RECORD_DIR = "decision-records";
export const REASONS_FILE = "decision-reasons.jsonl";
export const RECORD_SCHEMA = "finitemonkey/decision-record@1";
export const CHANGE_CLASSES = ["dependency", "vendor", "architecture"] as const;

export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export interface ClassifiedChange {
  readonly class: ChangeClass;
  readonly detail: string;
}

export interface DecisionRecord {
  readonly task: string;
  readonly contractHash: string | null;
  readonly at: string;
  readonly changes: readonly ClassifiedChange[];
  readonly paths: readonly string[];
  readonly alternatives: readonly string[];
  readonly criteria: readonly string[];
  readonly research: readonly string[];
  readonly evidence: string | null;
  readonly cost: { readonly gateRuns: number; readonly minutesToGreen: number | null };
}

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "Gemfile"] as const;
const VENDORS =
  /^(?:stripe|@stripe\/|@aws-sdk\/|aws-sdk|firebase|@firebase\/|@sendgrid\/|twilio|openai|@anthropic-ai\/|@supabase\/|auth0|@auth0\/|@sentry\/|@vercel\/|mercadopago|asaas|@google-cloud\/|algoliasearch|resend|@clerk\/|posthog)/;
const ARCH_FILES = /^(?:\.finitemonkey\/arch\.yml|docker-compose\.ya?ml|compose\.ya?ml|Dockerfile|terraform\/|infra\/)/;

export const recordPath = (paths: FmPaths, task: string): AbsolutePath =>
  toAbsolutePath(join(paths.dir, RECORD_DIR, `${task}.json`));

export const reasonsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, REASONS_FILE));

const dependencies = (text: string | undefined): ReadonlyMap<string, string> => {
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  if (parsed?.ok !== true) return new Map();
  return new Map(
    ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((key) => {
      const value = parsed.value[key];
      return isRecord(value)
        ? Object.entries(value).flatMap(([name, version]) =>
            typeof version === "string" ? [[name, version] as const] : [],
          )
        : [];
    }),
  );
};

const packageChanges = (before: string | undefined, after: string | undefined): readonly ClassifiedChange[] => {
  const left = dependencies(before);
  const right = dependencies(after);
  const added = [...right.keys()].filter((name) => !left.has(name));
  const removed = [...left.keys()].filter((name) => !right.has(name));
  const bumped = [...right.keys()].filter((name) => left.has(name) && left.get(name) !== right.get(name));
  return [
    ...added.map((name): ClassifiedChange => ({
      class: VENDORS.test(name) ? "vendor" : "dependency",
      detail: `+${name}`,
    })),
    ...removed.map((name): ClassifiedChange => ({
      class: VENDORS.test(name) ? "vendor" : "dependency",
      detail: `-${name}`,
    })),
    ...bumped.map((name): ClassifiedChange => ({
      class: "dependency",
      detail: `${name} ${left.get(name) ?? ""} -> ${right.get(name) ?? ""}`,
    })),
  ];
};

const topFolder = (path: string): string | undefined => {
  const parts = path.split("/");
  return parts.length > 2 && parts[0] === "src" ? `src/${parts[1] ?? ""}` : undefined;
};

export const classifyChanges = (
  runtime: Pick<Runtime, "exec" | "readText">,
  root: AbsolutePath,
  base: string,
): { readonly changes: readonly ClassifiedChange[]; readonly paths: readonly string[] } => {
  const git = gitAt(runtime, root);
  const changed = changedFiles(git, base);
  const paths = changed.map((change) => change.path);
  const read = (file: string): string | undefined => {
    const text = runtime.readText(toAbsolutePath(join(root, ...file.split("/"))));
    return text.ok ? text.value : undefined;
  };
  const manifests = changed.filter((change) => (MANIFESTS as readonly string[]).includes(change.path));
  const fromPackage = manifests.some((change) => change.path === "package.json")
    ? packageChanges(fileAt(git, base, "package.json"), read("package.json"))
    : [];
  const otherManifests = manifests
    .filter((change) => change.path !== "package.json")
    .map((change): ClassifiedChange => ({ class: "dependency", detail: change.path }));
  const known = new Set(
    (git.out(["ls-tree", "-r", "--name-only", base]) ?? "").split("\n").flatMap((file) => topFolder(file) ?? []),
  );
  const newFolders = [
    ...new Set(changed.filter((change) => change.status === "A").flatMap((change) => topFolder(change.path) ?? [])),
  ].filter((folder) => !known.has(folder));
  const arch = [
    ...changed.filter((change) => ARCH_FILES.test(change.path)).map((change) => change.path),
    ...newFolders.map((folder) => `${folder}/`),
  ].map((detail): ClassifiedChange => ({ class: "architecture", detail }));
  return { changes: [...fromPackage, ...otherManifests, ...arch], paths };
};

const researchFor = (runtime: Pick<Runtime, "readText" | "listDir">, paths: FmPaths, task: string) => {
  const listed = runtime.listDir(toAbsolutePath(join(paths.dir, "research")));
  const slugs = listed.ok
    ? listed.value.filter((name) => name.endsWith(".jsonl")).map((name) => name.replace(/\.jsonl$/, ""))
    : [];
  return slugs.flatMap((slug) => {
    const log = readResearchLog(runtime, paths, slug);
    return log !== undefined && (log.question.decision.includes(task) || slug.includes(task)) ? [log] : [];
  });
};

const costOf = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths, task: string) => {
  const ledger = readLedger(runtime, paths.evidence(task));
  const gates = ledger.filter((entry) => entry.check === GATE_CHECK);
  const passed = gates.findIndex((entry) => entry.status === "passed");
  const first = ledger[0];
  const done = gates[passed];
  const index = done === undefined ? -1 : ledger.indexOf(done);
  return {
    evidence: index < 0 ? null : `${task}:${String(index + 1)}`,
    cost: {
      gateRuns: passed < 0 ? gates.length : passed + 1,
      minutesToGreen:
        first === undefined || done === undefined
          ? null
          : Math.round((Date.parse(done.at) - Date.parse(first.at)) / 60_000),
    },
  };
};

export const assembleRecord = (
  runtime: Pick<Runtime, "exec" | "readText" | "listDir" | "homeDir" | "now">,
  paths: FmPaths,
  task: string,
): DecisionRecord | undefined => {
  const text = runtime.readText(paths.task(task));
  const parsed = text.ok ? parseContract(task, text.value) : undefined;
  const declared = parsed?.ok === true ? parsed.value.base : undefined;
  const base = resolveBase(gitAt(runtime, paths.root), declared);
  const { changes, paths: touched } = classifyChanges(runtime, paths.root, base);
  if (changes.length === 0) return undefined;
  const research = researchFor(runtime, paths, task);
  return {
    task,
    contractHash: readTrust(runtime, paths).contracts[task] ?? null,
    at: runtime.now(),
    changes,
    paths: touched,
    alternatives: [...new Set(research.flatMap((log) => log.question.options))],
    criteria: [...new Set(research.flatMap((log) => log.question.criteria))],
    research: research.map((log) => log.slug),
    ...costOf(runtime, paths, task),
  };
};

export const writeRecord = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  paths: FmPaths,
  record: DecisionRecord,
): boolean => {
  const file = recordPath(paths, record.task);
  if (runtime.readText(file).ok) return false;
  runtime.mkdir(toAbsolutePath(join(paths.dir, RECORD_DIR)));
  return runtime.writeText(file, `${JSON.stringify({ schema: RECORD_SCHEMA, ...record }, null, 2)}\n`).ok;
};

export const readReason = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): string | undefined => {
  const text = runtime.readText(reasonsPath(paths));
  const lines = text.ok ? text.value.split("\n") : [];
  return lines
    .flatMap((line) => {
      const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
      const value = parsed?.ok === true ? parsed.value : undefined;
      return value?.["task"] === task && typeof value["sentence"] === "string" ? [value["sentence"]] : [];
    })
    .at(-1);
};

export const recordOutcome = (
  runtime: Pick<Runtime, "readText" | "listDir" | "homeDir" | "exec">,
  paths: FmPaths,
  record: DecisionRecord,
): Outcome => {
  const entry: DecisionEntry = {
    id: record.task,
    source: "decide",
    at: record.at,
    subject: record.task,
    recommendation: "",
    evidence: record.evidence === null ? [] : [record.evidence],
    decision: "followed",
    paths: record.paths,
  };
  return outcomeOf(runtime, paths, commitsSince(runtime, paths.root, record.at), entry);
};

export const recordOnClose = (
  runtime: Pick<Runtime, "exec" | "readText" | "listDir" | "homeDir" | "now" | "writeText" | "mkdir">,
  paths: FmPaths,
  task: string,
): boolean => {
  if (featureMode(runtime, paths, DECISION_RECORD_FEATURE) === "off") return false;
  const record = assembleRecord(runtime, paths, task);
  return record === undefined ? false : writeRecord(runtime, paths, record);
};

export const readRecords = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  paths: FmPaths,
): readonly DecisionRecord[] => {
  const listed = runtime.listDir(toAbsolutePath(join(paths.dir, RECORD_DIR)));
  const files = listed.ok ? listed.value.filter((name) => name.endsWith(".json")).sort() : [];
  return files.flatMap((name) => {
    const text = runtime.readText(toAbsolutePath(join(paths.dir, RECORD_DIR, name)));
    const parsed = text.ok ? parseJsonObject(text.value) : undefined;
    if (parsed?.ok !== true || parsed.value["schema"] !== RECORD_SCHEMA) return [];
    const value = parsed.value;
    const strings = (key: string): readonly string[] => {
      const list = value[key];
      return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
    };
    const changes = Array.isArray(value["changes"])
      ? value["changes"].flatMap((item: unknown): ClassifiedChange[] => {
          if (!isRecord(item)) return [];
          const kind = CHANGE_CLASSES.find((entry) => entry === item["class"]);
          return kind === undefined || typeof item["detail"] !== "string"
            ? []
            : [{ class: kind, detail: item["detail"] }];
        })
      : [];
    const cost = isRecord(value["cost"]) ? value["cost"] : {};
    const task = value["task"];
    const at = value["at"];
    if (typeof task !== "string" || typeof at !== "string") return [];
    return [
      {
        task,
        at,
        contractHash: typeof value["contractHash"] === "string" ? value["contractHash"] : null,
        changes,
        paths: strings("paths"),
        alternatives: strings("alternatives"),
        criteria: strings("criteria"),
        research: strings("research"),
        evidence: typeof value["evidence"] === "string" ? value["evidence"] : null,
        cost: {
          gateRuns: typeof cost["gateRuns"] === "number" ? cost["gateRuns"] : 0,
          minutesToGreen: typeof cost["minutesToGreen"] === "number" ? cost["minutesToGreen"] : null,
        },
      },
    ];
  });
};

export const appendReason = (
  runtime: Pick<Runtime, "appendText" | "mkdir" | "now">,
  paths: FmPaths,
  task: string,
  sentence: string,
): boolean => {
  runtime.mkdir(paths.dir);
  return runtime.appendText(reasonsPath(paths), `${JSON.stringify({ task, sentence, at: runtime.now() })}\n`).ok;
};
