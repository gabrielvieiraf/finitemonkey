import { type ActionName, pinned } from "../actions.js";

export interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly uses?: ActionName;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
}

const INDENT = "      ";

const block = (key: string, values: Readonly<Record<string, string>> | undefined): readonly string[] =>
  values === undefined
    ? []
    : [`${INDENT}  ${key}:`, ...Object.entries(values).map(([name, value]) => `${INDENT}    ${name}: ${value}`)];

const NEEDS_BLOCK = /\n|: | #|^[[{"'*&!|>%@`]/;

const runLines = (run: string): readonly string[] =>
  NEEDS_BLOCK.test(run)
    ? [`${INDENT}  run: |`, ...run.split("\n").map((line) => (line === "" ? "" : `${INDENT}    ${line}`))]
    : [`${INDENT}  run: ${run}`];

export const stepLines = (step: Step): readonly string[] => {
  const head = [
    ...(step.id === undefined ? [] : [`id: ${step.id}`]),
    ...(step.name === undefined ? [] : [`name: ${step.name}`]),
    ...(step.if === undefined ? [] : [`if: ${step.if}`]),
    ...(step.uses === undefined ? [] : [`uses: ${pinned(step.uses)}`]),
  ];
  const [first = "", ...rest] = head;
  const body = [
    ...rest.map((line) => `${INDENT}  ${line}`),
    ...block("with", step.with),
    ...block("env", step.env),
    ...(step.run === undefined ? [] : runLines(step.run)),
  ];
  if (first === "") {
    const [only = "", ...others] = body;
    return [`${INDENT}- ${only.trimStart()}`, ...others];
  }
  return [`${INDENT}- ${first}`, ...body];
};

export const checkout = (extra: Readonly<Record<string, string>> = {}): Step => ({
  uses: "actions/checkout",
  with: { "persist-credentials": "false", ...extra },
});

export interface Job {
  readonly id: string;
  readonly name?: string;
  readonly if?: string;
  readonly timeout: number;
  readonly environment?: string;
  readonly permissions?: Readonly<Record<string, string>>;
  readonly steps: readonly Step[];
}

export const jobLines = (job: Job): readonly string[] => [
  `  ${job.id}:`,
  ...(job.name === undefined ? [] : [`    name: ${job.name}`]),
  ...(job.if === undefined ? [] : [`    if: ${job.if}`]),
  "    runs-on: ubuntu-latest",
  `    timeout-minutes: ${String(job.timeout)}`,
  ...(job.environment === undefined ? [] : [`    environment: ${job.environment}`]),
  ...(job.permissions === undefined
    ? []
    : ["    permissions:", ...Object.entries(job.permissions).map(([scope, level]) => `      ${scope}: ${level}`)]),
  "    steps:",
  ...job.steps.flatMap(stepLines),
];

export interface Workflow {
  readonly name: string;
  readonly on: readonly string[];
  readonly concurrency: { readonly group: string; readonly cancel: string };
  readonly jobs: readonly Job[];
}

export const workflowText = (workflow: Workflow): string =>
  [
    `name: ${workflow.name}`,
    "",
    "on:",
    ...workflow.on.map((line) => `  ${line}`),
    "",
    "permissions:",
    "  contents: read",
    "",
    "concurrency:",
    `  group: ${workflow.concurrency.group}`,
    `  cancel-in-progress: ${workflow.concurrency.cancel}`,
    "",
    "jobs:",
    ...workflow.jobs.flatMap((job, index) => [...(index === 0 ? [] : [""]), ...jobLines(job)]),
    "",
  ].join("\n");
