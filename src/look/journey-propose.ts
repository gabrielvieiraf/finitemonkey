import type { AbsolutePath } from "../core/brand.js";
import { isRecord, type Parsed, parseJson, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { YamlValue } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { logEvent } from "../evidence/log.js";
import { configAt, type ConfigTree } from "../git/project-config.js";
import type { FmPaths } from "../task/paths.js";
import { proposeJourney } from "./journey.js";

const PROPOSER_TIMEOUT_MS = 120_000;
const MAX_DEPTH = 6;

export interface JourneyRequest {
  readonly sentence: string;
  readonly routes: readonly string[];
}

export type JourneyProposer = (request: JourneyRequest) => Promise<unknown>;

export const proposerCommand = (tree: ConfigTree): string | undefined => {
  const value = configAt(tree, "journeys", "proposer");
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

export const commandProposer =
  (runtime: Pick<Runtime, "exec">, root: AbsolutePath, command: string): JourneyProposer =>
  (request) => {
    const result = runtime.exec({
      command,
      args: [],
      cwd: root,
      shell: true,
      timeoutMs: PROPOSER_TIMEOUT_MS,
      input: JSON.stringify(request),
    });
    const parsed = result.found && result.exitCode === 0 && !result.timedOut ? parseJson(result.stdout) : undefined;
    return Promise.resolve(parsed?.ok === true ? parsed.value : undefined);
  };

const yamlOf = (value: unknown, depth: number): YamlValue | undefined => {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.flatMap((item: unknown) => yamlOf(item, depth + 1) ?? []);
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, item]) => {
    const converted = yamlOf(item, depth + 1);
    return converted === undefined ? [] : [[key, converted] as const];
  });
  return Object.fromEntries(entries);
};

export const stepsOf = (raw: unknown): YamlValue | undefined => {
  const steps = isRecord(raw) ? raw["steps"] : raw;
  return Array.isArray(steps) ? yamlOf(steps, 0) : undefined;
};

export const proposeFromSentence = async (
  runtime: Pick<Runtime, "writeText" | "mkdir" | "appendText" | "now">,
  paths: FmPaths,
  name: string,
  request: JourneyRequest,
  proposer: JourneyProposer,
): Promise<Parsed<string, readonly string[]>> => {
  const raw = await proposer(request).catch(() => undefined);
  const steps = stepsOf(raw);
  if (steps === undefined) return reject(["$.steps: the proposer returned no list of steps"]);
  const named = isRecord(raw) ? raw["user"] : undefined;
  const user = named === "A" || named === "B" ? { user: named } : {};
  const made = proposeJourney(runtime, paths, name, stringifyYaml({ says: request.sentence, ...user, steps }));
  if (made.ok) logEvent(runtime, paths, "journey.proposed", { name, hash: made.value, origin: "model-proposed" });
  return made;
};
