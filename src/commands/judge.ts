import { listOption, stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { type JsonObject, parseJsonObject } from "../core/parsed.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { readAll } from "../hooks/stdin.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { judgeLines } from "../judge/lines.js";
import { parseRequest } from "../judge/request.js";
import { JUDGE_FEATURE } from "../judge/types.js";
import { type JudgeDeps, runVerb } from "../judge/verbs.js";
import { featureMode } from "../policy/feature.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec, OptionsConfig, OptionValues } from "./types.js";

type Build = (ctx: Ctx, values: OptionValues, positionals: readonly string[], root: string) => JsonObject | undefined;

export const refuse = (ctx: Ctx, key: MessageKey, fix: string, detail = ""): CommandResult =>
  failureFrom(ctx.t, {
    code: "judge_refused",
    messageKey: key,
    params: { detail },
    fix,
    exitCode: ExitCode.Usage,
  });

export const judgeDeps = (ctx: Ctx, root: string): JudgeDeps => ({
  runtime: ctx.runtime,
  paths: fmPaths(toAbsolutePath(root)),
});

export const answer = (ctx: Ctx, root: string, record: JsonObject, usage: string): CommandResult => {
  const request = parseRequest(record);
  if (request === undefined) return refuse(ctx, "judge.error.usage", usage);
  const data = runVerb(judgeDeps(ctx, root), request);
  return data.ok ? success(data, judgeLines(ctx.t, data)) : refuse(ctx, "judge.error.rejected", usage, data.reason);
};

interface JudgeSpec {
  readonly path: readonly [string, ...string[]];
  readonly summaryKey: MessageKey;
  readonly usage: string;
  readonly options?: OptionsConfig;
  readonly maxPositionals?: number;
  readonly person?: boolean;
  readonly build: Build;
}

export const judgeCommand = (spec: JudgeSpec): CommandSpec => ({
  path: spec.path,
  summaryKey: spec.summaryKey,
  usage: spec.usage,
  status: "ready",
  ...(spec.options === undefined ? {} : { options: spec.options }),
  ...(spec.maxPositionals === undefined ? {} : { maxPositionals: spec.maxPositionals }),
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      if (featureMode(ctx.runtime, fmPaths(root), JUDGE_FEATURE) === "off")
        return refuse(ctx, "judge.error.off", "set judge-core: shadow in .finitemonkey/policy.yml");
      if (spec.person === true && !isPerson(ctx)) return refuse(ctx, "judge.error.person", spec.usage);
      const record = spec.build(ctx, args.values, args.positionals, root);
      return record === undefined
        ? refuse(ctx, "judge.error.usage", spec.usage)
        : answer(ctx, root, record, spec.usage);
    }),
});

const readFileAt = (ctx: Ctx, root: string, file: string): string | undefined => {
  const text = ctx.runtime.readText(toAbsolutePath(file, toAbsolutePath(root)));
  return text.ok ? text.value : undefined;
};

export const judgeObserveCommand = judgeCommand({
  path: ["judge", "observe"],
  summaryKey: "command.judge_observe.summary",
  usage: "finitemonkey judge observe --concept <id> --proof <kind> [--result pass|fail] [--ref <hash>] [--claim <id>]",
  options: {
    concept: { type: "string", multiple: true },
    proof: { type: "string" },
    result: { type: "string" },
    ref: { type: "string" },
    claim: { type: "string" },
  },
  build: (_ctx, values) => ({
    verb: "observe",
    concepts: listOption(values, "concept"),
    proof: stringOption(values, "proof"),
    result: stringOption(values, "result"),
    ref: stringOption(values, "ref"),
    claim: stringOption(values, "claim"),
  }),
});

export const judgeClassifyCommand = judgeCommand({
  path: ["judge", "classify"],
  summaryKey: "command.judge_classify.summary",
  usage: "finitemonkey judge classify <file> [--task <id>] [--domain <id>]",
  options: { task: { type: "string" }, domain: { type: "string" } },
  maxPositionals: 1,
  build: (ctx, values, positionals, root) => {
    const file = positionals[0];
    const text = file === undefined ? undefined : readFileAt(ctx, root, file);
    if (file === undefined || text === undefined) return undefined;
    return { verb: "classify", file, text, task: stringOption(values, "task"), domain: stringOption(values, "domain") };
  },
});

export const judgeVerifyCommand = judgeCommand({
  path: ["judge", "verify"],
  summaryKey: "command.judge_verify.summary",
  usage: "finitemonkey judge verify <claim>",
  maxPositionals: 1,
  build: (_ctx, _values, positionals) => ({ verb: "verify", claim: positionals[0] }),
});

export const judgeAskCommand = judgeCommand({
  path: ["judge", "ask"],
  summaryKey: "command.judge_ask.summary",
  usage: 'finitemonkey judge ask --task <id> --decision "<text>" --question "<text>" --criterion "<text>"',
  options: {
    task: { type: "string" },
    decision: { type: "string" },
    question: { type: "string" },
    criterion: { type: "string" },
  },
  build: (_ctx, values) => ({
    verb: "ask",
    task: stringOption(values, "task"),
    decision: stringOption(values, "decision"),
    question: stringOption(values, "question"),
    criterion: stringOption(values, "criterion"),
  }),
});

export const judgeHandoffCommand = judgeCommand({
  path: ["judge", "handoff"],
  summaryKey: "command.judge_handoff.summary",
  usage: 'finitemonkey judge handoff <claim> --to <who> --missing "<text>"',
  options: { to: { type: "string" }, missing: { type: "string" } },
  maxPositionals: 1,
  build: (_ctx, values, positionals) => ({
    verb: "handoff",
    claim: positionals[0],
    to: stringOption(values, "to"),
    missing: stringOption(values, "missing"),
  }),
});

export const judgeCallCommand: CommandSpec = {
  path: ["judge", "call"],
  summaryKey: "command.judge_call.summary",
  usage: "finitemonkey judge call < request.json",
  status: "ready",
  run: async (ctx) => {
    const raw = await readAll(ctx.io.stdin);
    return inGuardianRepo(ctx, (root) => {
      const parsed = parseJsonObject(raw);
      if (!parsed.ok) return refuse(ctx, "judge.error.usage", "finitemonkey judge call < request.json");
      const verb = parsed.value["verb"];
      if ((verb === "contest" || verb === "forget") && !isPerson(ctx))
        return refuse(ctx, "judge.error.person", "finitemonkey judge call < request.json");
      if (featureMode(ctx.runtime, fmPaths(root), JUDGE_FEATURE) === "off")
        return refuse(ctx, "judge.error.off", "set judge-core: shadow in .finitemonkey/policy.yml");
      return answer(ctx, root, parsed.value, "finitemonkey judge call < request.json");
    });
  },
};
