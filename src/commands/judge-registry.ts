import { listOption, stringOption } from "../core/args.js";
import {
  judgeAskCommand,
  judgeCallCommand,
  judgeClassifyCommand,
  judgeCommand,
  judgeHandoffCommand,
  judgeObserveCommand,
  judgeVerifyCommand,
} from "./judge.js";
import type { CommandSpec } from "./types.js";

export const judgeContestCommand = judgeCommand({
  path: ["judge", "contest"],
  summaryKey: "command.judge_contest.summary",
  usage: 'finitemonkey judge contest <entry-or-concept> [--reason "<text>"]',
  options: { reason: { type: "string" } },
  maxPositionals: 1,
  person: true,
  build: (_ctx, values, positionals) => ({
    verb: "contest",
    target: positionals[0],
    reason: stringOption(values, "reason"),
  }),
});

export const judgeFadeCommand = judgeCommand({
  path: ["judge", "fade"],
  summaryKey: "command.judge_fade.summary",
  usage: "finitemonkey judge fade [<concept>]",
  maxPositionals: 1,
  build: (_ctx, _values, positionals) => ({ verb: "fade", concept: positionals[0] }),
});

export const judgeReportCommand = judgeCommand({
  path: ["judge", "report"],
  summaryKey: "command.judge_report.summary",
  usage: "finitemonkey judge report",
  build: () => ({ verb: "report" }),
});

export const judgeExportCommand = judgeCommand({
  path: ["judge", "export"],
  summaryKey: "command.judge_export.summary",
  usage: "finitemonkey judge export",
  build: () => ({ verb: "export" }),
});

export const judgeForgetCommand = judgeCommand({
  path: ["judge", "forget"],
  summaryKey: "command.judge_forget.summary",
  usage: "finitemonkey judge forget [<id>]",
  maxPositionals: 1,
  person: true,
  build: (_ctx, _values, positionals) => ({ verb: "forget", id: positionals[0] }),
});

export const judgeConceptCommand = judgeCommand({
  path: ["judge", "concept"],
  summaryKey: "command.judge_concept.summary",
  usage:
    'finitemonkey judge concept "<label>" --domain <id> --source <doi|url|file> --span "<text>" [--synonym <term>]',
  options: {
    domain: { type: "string" },
    synonym: { type: "string", multiple: true },
    source: { type: "string" },
    span: { type: "string" },
  },
  maxPositionals: 1,
  build: (_ctx, values, positionals) => ({
    verb: "concept",
    label: positionals[0],
    domain: stringOption(values, "domain"),
    synonyms: listOption(values, "synonym"),
    source: stringOption(values, "source"),
    span: stringOption(values, "span"),
  }),
});

export const judgeDomainCommand = judgeCommand({
  path: ["judge", "domain"],
  summaryKey: "command.judge_domain.summary",
  usage: "finitemonkey judge domain <id> [--parent <id>]",
  options: { parent: { type: "string" } },
  maxPositionals: 1,
  build: (_ctx, values, positionals) => ({
    verb: "domain",
    domain: positionals[0],
    parent: stringOption(values, "parent"),
  }),
});

export const JUDGE_COMMANDS = [
  judgeObserveCommand,
  judgeClassifyCommand,
  judgeVerifyCommand,
  judgeAskCommand,
  judgeHandoffCommand,
  judgeContestCommand,
  judgeFadeCommand,
  judgeReportCommand,
  judgeExportCommand,
  judgeForgetCommand,
  judgeCallCommand,
  judgeConceptCommand,
  judgeDomainCommand,
] as const satisfies readonly CommandSpec[];
