import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { compareNumber, type NumberLocale, numbersIn } from "../judge/numbers.js";
import type { InputProposer, TeachProposer, TeachTemplate } from "./types.js";

export const RUN_TIMEOUT_MS = 30_000;

export interface Keyed {
  readonly run: string;
  readonly input: string;
  readonly key: string;
  readonly inputFrom: TeachProposer;
}

export const executedKey = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
  run: string,
  input: string,
): string | undefined => {
  const result = runtime.exec({
    command: run,
    args: [],
    cwd: root,
    shell: true,
    timeoutMs: RUN_TIMEOUT_MS,
    env: { CI: "1" },
    unset: ["NODE_TEST_CONTEXT"],
    input,
  });
  if (!result.found || result.timedOut || result.exitCode !== 0) return undefined;
  const out = result.stdout.trim();
  return out === "" ? undefined : out;
};

export const keyedQuestion = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
  template: TeachTemplate,
  concepts: readonly string[],
  proposer?: InputProposer,
): Keyed | undefined => {
  const proposed = proposer?.({ concepts, run: template.run, input: template.input });
  const fromProvider = proposed !== undefined && proposed.input.trim() !== "";
  const input = fromProvider ? proposed.input : template.input;
  const key = executedKey(runtime, root, template.run, input);
  if (key !== undefined) return { run: template.run, input, key, inputFrom: fromProvider ? "provider" : "template" };
  if (!fromProvider) return undefined;
  const fallback = executedKey(runtime, root, template.run, template.input);
  return fallback === undefined
    ? undefined
    : { run: template.run, input: template.input, key: fallback, inputFrom: "template" };
};

const normalized = (text: string): string => text.trim().replace(/\s+/g, " ");

export const sameAnswer = (answer: string, key: string, locale: NumberLocale = "en"): boolean => {
  if (normalized(answer) === normalized(key)) return true;
  const said = numbersIn(answer, locale);
  const actual = numbersIn(key, locale);
  if (said.length === 0 || said.length !== actual.length) return false;
  return said.every((found, index) => {
    const other = actual[index];
    return other !== undefined && compareNumber(found, [other]) === "same";
  });
};
