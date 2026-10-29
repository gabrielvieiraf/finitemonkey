import { conceptsIn } from "../../conceitos/concepts.js";
import { revokeDemonstrated, settlePredictions } from "../../conceitos/predict.js";
import { nowMs } from "../../core/clock.js";
import { logEvent } from "../../evidence/log.js";
import type { Note } from "../../evidence/types.js";
import { planMutants } from "../../mutation/operators.js";
import { type Criterion, isDecorative, measureStrength } from "../../mutation/strength.js";
import { featureMode, recordFeatureShadow } from "../../policy/feature.js";
import { outputOf } from "../../ricochete/divergence.js";
import { BEHAVIOR_FEATURE, type Example } from "../../task/examples.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { addedLines } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";
import { runShellCheck } from "./command.js";
import { MAX_MUTANTS } from "./mutation.js";

const EXAMPLE_TIMEOUT_MS = 60_000;
const MIN_REMAINING_MS = 1000;
const SHOWN = 120;

export interface ExampleResult {
  readonly example: Example;
  readonly passed: boolean;
  readonly actual: string;
}

const clip = (text: string): string => (text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text);

export const runExample = (example: Example, at: GateContext): ExampleResult | undefined => {
  const remaining = at.deadline - nowMs(at.runtime);
  if (remaining < MIN_REMAINING_MS) return undefined;
  const result = at.runtime.exec({
    command: example.run,
    args: [],
    cwd: at.paths.root,
    timeoutMs: Math.min(remaining, EXAMPLE_TIMEOUT_MS),
    shell: true,
    env: { CI: "1" },
    unset: ["NODE_TEST_CONTEXT"],
    ...(example.input === undefined ? {} : { input: example.input }),
  });
  if (!result.found || result.timedOut) return undefined;
  const actual = result.stdout.trim();
  return { example, passed: result.exitCode === 0 && actual === example.expect.trim(), actual };
};

const exampleCriterion = (example: Example): Criterion => ({
  id: example.id,
  passes: (at) => runExample(example, at)?.passed,
});

const testsCriterion = (ctx: GateContext): readonly Criterion[] => {
  const tests = ctx.contract.acceptance.find((item) => item.kind === "tests" && item.run !== undefined);
  const run = tests?.run;
  if (tests === undefined || run === undefined) return [];
  return [
    {
      id: tests.id,
      passes: (at) => {
        const outcome = runShellCheck(tests, run, at, { pin: false });
        return outcome.status === "unverified" ? undefined : outcome.status === "passed";
      },
    },
  ];
};

const strengthNotes = (ctx: GateContext, examples: readonly Example[]): readonly Note[] => {
  const mutants = planMutants(addedLines(ctx.git, ctx.base), MAX_MUTANTS);
  if (mutants.length === 0) return [note("gate.examples.no_mutants")];
  const strength = measureStrength(ctx, [...examples.map(exampleCriterion), ...testsCriterion(ctx)], mutants);
  if (strength.kind === "unavailable")
    return [note("gate.examples.strength_unavailable", { detail: ctx.mask(strength.detail) })];
  const decorative = strength.criteria.filter(isDecorative).map((item) => item.id);
  logEvent(ctx.runtime, ctx.paths, "contract.strength", {
    task: ctx.contract.id,
    mutants: mutants.length,
    criteria: strength.criteria.map((item) => ({ id: item.id, killed: item.killed, measured: item.measured })),
    decorative,
  });
  return strength.criteria.map((item) =>
    isDecorative(item)
      ? note("gate.examples.decorative", { id: item.id, total: item.total })
      : note("gate.examples.strength", { id: item.id, killed: item.killed, total: item.total }),
  );
};

const failureNote = (result: ExampleResult, ctx: GateContext): Note =>
  note("gate.examples.failed", {
    id: result.example.id,
    says: result.example.says,
    expected: clip(result.example.expect.trim()),
    actual: clip(ctx.mask(result.actual)) || "-",
  });

const predictionNotes = (ctx: GateContext): readonly Note[] =>
  settlePredictions(ctx.runtime, ctx.paths, ctx.contract.id, (probe) =>
    outputOf(ctx.runtime, ctx.paths.root, probe.run, probe.input),
  ).map((item) =>
    note(item.correct ? "gate.predict.correct" : "gate.predict.wrong", {
      concept: item.prediction.concept,
      predicted: clip(item.prediction.output),
      actual: clip(ctx.mask(item.actual)) || "-",
      input: item.prediction.probe.input || "-",
    }),
  );

const revokeNotes = (ctx: GateContext): readonly Note[] => {
  const text = addedLines(ctx.git, ctx.base)
    .map((line) => line.text)
    .join("\n");
  return revokeDemonstrated(ctx.runtime, ctx.paths, conceptsIn(text)).map((concept) =>
    note("gate.predict.revoked", { concept }),
  );
};

export const examplesCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const predicted = ctx.trusted ? predictionNotes(ctx) : [];
  const mode = featureMode(ctx.runtime, ctx.paths, BEHAVIOR_FEATURE);
  if (mode === "off") return passed([note("gate.examples.off"), ...predicted]);
  const examples = ctx.examples ?? [];
  if (examples.length === 0) return passed([note("gate.examples.none"), ...predicted]);
  if (!ctx.trusted) return unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]);
  const results = examples.map((example) => runExample(example, ctx));
  if (results.some((result) => result === undefined))
    return unverified("budget", [note("gate.examples.not_run"), ...predicted]);
  const failures = results.filter((result): result is ExampleResult => result !== undefined && !result.passed);
  if (failures.length === 0)
    return passed([
      note("gate.examples.passed", { count: examples.length }),
      ...predicted,
      ...strengthNotes(ctx, examples),
    ]);
  const notes = [...failures.map((result) => failureNote(result, ctx)), ...predicted, ...revokeNotes(ctx)];
  if (mode === "active") return failed(notes);
  recordFeatureShadow(ctx.runtime, ctx.paths, BEHAVIOR_FEATURE, {
    task: ctx.contract.id,
    wouldBe: "failed",
    examples: failures.map((result) => result.example.id),
  });
  return passed([...notes, note("gate.examples.shadow", { count: failures.length })]);
};
