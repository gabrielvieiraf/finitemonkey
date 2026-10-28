import { accept, type Parsed, reject } from "../../core/parsed.js";
import { parseYaml, type YamlValue } from "../../core/yaml/parse.js";

type YamlMap = Readonly<Record<string, YamlValue>>;

export interface WorkflowStep {
  readonly index: number;
  readonly uses: string | undefined;
  readonly run: string | undefined;
  readonly with: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
}

export type Permissions = "missing" | "read-all" | "write-all" | Readonly<Record<string, string>>;

export interface WorkflowJob {
  readonly id: string;
  readonly name: string;
  readonly if: string;
  readonly uses: string | undefined;
  readonly runsOn: readonly string[];
  readonly timeout: boolean;
  readonly environment: string | undefined;
  readonly needs: readonly string[];
  readonly concurrency: boolean;
  readonly permissions: Permissions;
  readonly steps: readonly WorkflowStep[];
}

export interface Workflow {
  readonly file: string;
  readonly text: string;
  readonly triggers: readonly string[];
  readonly permissions: Permissions;
  readonly concurrency: boolean;
  readonly jobs: readonly WorkflowJob[];
}

const isMap = (value: YamlValue | undefined): value is YamlMap =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const scalar = (value: YamlValue | undefined): string =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";

const strings = (value: YamlValue | undefined): readonly string[] =>
  Array.isArray(value) ? value.map((item: YamlValue) => scalar(item)) : value === undefined ? [] : [scalar(value)];

const record = (value: YamlValue | undefined): Readonly<Record<string, string>> =>
  isMap(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scalar(item)])) : {};

const permissionsOf = (value: YamlValue | undefined): Permissions => {
  if (value === undefined) return "missing";
  if (value === "write-all" || value === "read-all") return value;
  return record(value);
};

const triggersOf = (value: YamlValue | undefined): readonly string[] =>
  isMap(value) ? Object.keys(value) : strings(value);

const stepOf = (value: YamlValue, index: number): WorkflowStep => {
  const step = isMap(value) ? value : {};
  return {
    index,
    uses: typeof step["uses"] === "string" ? step["uses"] : undefined,
    run: typeof step["run"] === "string" ? step["run"] : undefined,
    with: record(step["with"]),
    env: record(step["env"]),
  };
};

const jobOf = (id: string, value: YamlValue): WorkflowJob => {
  const job = isMap(value) ? value : {};
  const runsOn = job["runs-on"];
  const steps = job["steps"];
  return {
    id,
    name: scalar(job["name"]),
    if: scalar(job["if"]),
    uses: typeof job["uses"] === "string" ? job["uses"] : undefined,
    runsOn: isMap(runsOn) ? strings(runsOn["labels"]) : strings(runsOn),
    timeout: job["timeout-minutes"] !== undefined,
    environment: job["environment"] === undefined ? undefined : scalar(job["environment"]) || "set",
    needs: strings(job["needs"]),
    concurrency: job["concurrency"] !== undefined,
    permissions: permissionsOf(job["permissions"]),
    steps: Array.isArray(steps) ? steps.map((step: YamlValue, index) => stepOf(step, index)) : [],
  };
};

export const parseWorkflow = (file: string, text: string): Parsed<Workflow> => {
  const parsed = parseYaml(text);
  if (!parsed.ok) return reject(`line ${String(parsed.error.line)}: ${parsed.error.message}`);
  const root = parsed.value;
  if (!isMap(root)) return reject("a workflow is a mapping");
  const jobs = root["jobs"];
  return accept({
    file,
    text,
    triggers: triggersOf(root["on"] ?? root["true"]),
    permissions: permissionsOf(root["permissions"]),
    concurrency: root["concurrency"] !== undefined,
    jobs: isMap(jobs) ? Object.entries(jobs).map(([id, job]) => jobOf(id, job)) : [],
  });
};
