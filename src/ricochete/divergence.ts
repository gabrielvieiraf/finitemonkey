import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, loadProjectConfig } from "../git/project-config.js";
import { readProfile } from "../perfil/store.js";
import { type Domain, levelOf, parseDomain } from "../perfil/types.js";
import type { Example } from "../task/examples.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import type { TaskContract } from "../task/types.js";

export const DIVERGENCE_FEATURE = "divergence-ask";
export const DEFAULT_READINGS = 3;
export const DEFAULT_ROUNDS = 3;
export const MAX_INPUTS = 12;
const RUN_TIMEOUT_MS = 30_000;
const GENERATOR_TIMEOUT_MS = 15 * 60_000;
const PENDING_FILE = "divergence.json";
const LETTERS = "ABCDEFGH";

export type Topic = "intent" | "technical";

export interface Reading {
  readonly id: string;
  readonly summary: string;
  readonly dir: AbsolutePath;
  readonly noChange: boolean;
}

export interface Probe {
  readonly input: string;
  readonly topic: Topic;
  readonly domain?: Domain;
}

export interface Candidates {
  readonly readings: readonly Omit<Reading, "id" | "noChange">[];
  readonly inputs: readonly Probe[];
}

export interface CandidateRequest {
  readonly task: string;
  readonly goal: string;
  readonly readings: number;
  readonly examples: readonly Example[];
}

export interface CandidateSource {
  readonly generate: (request: CandidateRequest) => Candidates | undefined;
}

export interface DivergenceConfig {
  readonly generator: string | undefined;
  readonly readings: number;
  readonly rounds: number;
}

const count = (raw: unknown, fallback: number, max: number): number => {
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const divergenceConfig = (runtime: Runtime, root: AbsolutePath): DivergenceConfig => {
  const tree = loadProjectConfig(runtime, root);
  const generator = configAt(tree, "divergence", "generator");
  return {
    generator: typeof generator === "string" && generator.trim() !== "" ? generator : undefined,
    readings: count(configAt(tree, "divergence", "readings"), DEFAULT_READINGS, LETTERS.length - 1),
    rounds: count(configAt(tree, "divergence", "rounds"), DEFAULT_ROUNDS, 20),
  };
};

const probeOf = (value: unknown): Probe | undefined => {
  if (typeof value === "string") return { input: value, topic: "intent" };
  if (!isRecord(value) || typeof value["input"] !== "string") return undefined;
  const domain = parseDomain(typeof value["domain"] === "string" ? value["domain"] : undefined);
  return {
    input: value["input"],
    topic: value["topic"] === "technical" ? "technical" : "intent",
    ...(domain === undefined ? {} : { domain }),
  };
};

export const parseCandidates = (text: string): Candidates | undefined => {
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const readings = parsed.value["readings"];
  const inputs = parsed.value["inputs"];
  if (!Array.isArray(readings)) return undefined;
  return {
    readings: readings.flatMap((item: unknown) =>
      isRecord(item) && typeof item["dir"] === "string" && item["dir"] !== ""
        ? [
            {
              dir: toAbsolutePath(item["dir"]),
              summary: typeof item["summary"] === "string" ? item["summary"] : "",
            },
          ]
        : [],
    ),
    inputs: (Array.isArray(inputs) ? inputs : []).flatMap((item: unknown) => {
      const probe = probeOf(item);
      return probe === undefined ? [] : [probe];
    }),
  };
};

export const commandSource = (runtime: Runtime, root: AbsolutePath, command: string): CandidateSource => ({
  generate: (request) => {
    const result = runtime.exec({
      command,
      args: [],
      cwd: root,
      shell: true,
      timeoutMs: GENERATOR_TIMEOUT_MS,
      input: JSON.stringify(request),
    });
    return result.found && result.exitCode === 0 ? parseCandidates(result.stdout) : undefined;
  },
});

export const outputOf = (runtime: Runtime, dir: AbsolutePath, run: string, input: string): string => {
  const result = runtime.exec({
    command: run,
    args: [],
    cwd: dir,
    shell: true,
    timeoutMs: RUN_TIMEOUT_MS,
    env: { CI: "1" },
    unset: ["NODE_TEST_CONTEXT"],
    input,
  });
  const out = result.stdout.trim();
  if (result.timedOut) return "(timed out)";
  return result.exitCode === 0 ? out : `(exit ${String(result.exitCode ?? -1)}) ${out}`.trim();
};

export interface Option {
  readonly letter: string;
  readonly readings: readonly string[];
  readonly output: string;
}

export interface Question {
  readonly task: string;
  readonly input: string;
  readonly run: string;
  readonly topic: Topic;
  readonly options: readonly Option[];
}

export type Outcome =
  | { readonly kind: "question"; readonly question: Question }
  | { readonly kind: "agree"; readonly readings: number; readonly inputs: number }
  | { readonly kind: "no_change"; readonly reading: string }
  | { readonly kind: "too_few"; readonly readings: number };

const passesAll = (runtime: Runtime, reading: Reading, examples: readonly Example[]): boolean =>
  examples.every(
    (example) => outputOf(runtime, reading.dir, example.run, example.input ?? "") === example.expect.trim(),
  );

const allowed = (probe: Probe, beginner: (domain: Domain) => boolean): boolean =>
  probe.topic === "intent" || probe.domain === undefined || !beginner(probe.domain);

const optionsFor = (runtime: Runtime, readings: readonly Reading[], run: string, input: string): readonly Option[] => {
  const groups = new Map<string, string[]>();
  for (const reading of readings) {
    const output = outputOf(runtime, reading.dir, run, input);
    groups.set(output, [...(groups.get(output) ?? []), reading.id]);
  }
  return [...groups.entries()].map(([output, ids], index) => ({
    letter: LETTERS[index] ?? String(index),
    readings: ids,
    output,
  }));
};

export interface DivergenceInput {
  readonly runtime: Runtime;
  readonly root: AbsolutePath;
  readonly task: string;
  readonly examples: readonly Example[];
  readonly candidates: Candidates;
  readonly beginner: (domain: Domain) => boolean;
}

export const withNoChange = (root: AbsolutePath, candidates: Candidates): readonly Reading[] => [
  { id: "R0", summary: "no change", dir: root, noChange: true },
  ...candidates.readings.map((reading, index) => ({ ...reading, id: `R${String(index + 1)}`, noChange: false })),
];

export const findDivergence = (input: DivergenceInput): Outcome => {
  const { runtime, examples } = input;
  const readings = withNoChange(input.root, input.candidates);
  const noChange = readings[0];
  if (noChange !== undefined && examples.length > 0 && passesAll(runtime, noChange, examples))
    return { kind: "no_change", reading: noChange.id };
  const live = readings.filter((reading) => !reading.noChange && passesAll(runtime, reading, examples));
  if (live.length < 2) return { kind: "too_few", readings: live.length };
  const run = examples[0]?.run;
  const probes = input.candidates.inputs.slice(0, MAX_INPUTS).filter((probe) => allowed(probe, input.beginner));
  if (run === undefined) return { kind: "agree", readings: live.length, inputs: 0 };
  for (const probe of probes) {
    const options = optionsFor(runtime, live, run, probe.input);
    if (options.length > 1)
      return { kind: "question", question: { task: input.task, input: probe.input, run, topic: probe.topic, options } };
  }
  return { kind: "agree", readings: live.length, inputs: probes.length };
};

export const beginnerIn =
  (runtime: Runtime, paths: FmPaths) =>
  (domain: Domain): boolean => {
    const profile = readProfile(runtime, paths);
    return profile !== undefined && levelOf(profile.domains[domain].knowledge) === "beginner";
  };

export const eligible = (contract: TaskContract, examples: readonly Example[]): "small" | "no_examples" | undefined => {
  if (contract.size === "S") return "small";
  return examples.length === 0 ? "no_examples" : undefined;
};

interface PendingState {
  readonly pending: Readonly<Record<string, Question>>;
  readonly rounds: Readonly<Record<string, number>>;
}

const toQuestion = (value: unknown): Question | undefined => {
  if (!isRecord(value)) return undefined;
  const { task, input, run, topic, options } = value;
  if (typeof task !== "string" || typeof input !== "string" || typeof run !== "string" || !Array.isArray(options))
    return undefined;
  const parsed = options.flatMap((item: unknown): Option[] =>
    isRecord(item) && typeof item["letter"] === "string" && typeof item["output"] === "string"
      ? [
          {
            letter: item["letter"],
            output: item["output"],
            readings: Array.isArray(item["readings"])
              ? item["readings"].filter((id): id is string => typeof id === "string")
              : [],
          },
        ]
      : [],
  );
  return { task, input, run, topic: topic === "technical" ? "technical" : "intent", options: parsed };
};

export const readPending = (runtime: Pick<Runtime, "readText">, paths: FmPaths): PendingState => {
  const raw = readJsonFile(runtime, paths.cache(PENDING_FILE));
  const pending = isRecord(raw?.["pending"]) ? raw["pending"] : {};
  const rounds = isRecord(raw?.["rounds"]) ? raw["rounds"] : {};
  return {
    pending: Object.fromEntries(
      Object.entries(pending).flatMap(([task, value]) => {
        const question = toQuestion(value);
        return question === undefined ? [] : [[task, question]];
      }),
    ),
    rounds: Object.fromEntries(
      Object.entries(rounds).flatMap(([task, value]) => (typeof value === "number" ? [[task, value]] : [])),
    ),
  };
};

export const writePending = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, state: PendingState): void => {
  writeJsonFile(runtime, paths.cache(PENDING_FILE), {
    pending: Object.fromEntries(Object.entries(state.pending).map(([task, question]) => [task, { ...question }])),
    rounds: { ...state.rounds },
  });
};
