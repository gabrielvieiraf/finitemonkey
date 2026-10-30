import type { Bucket, Interval, TeamReport } from "./report.js";

const interval = (value: Interval | null): string =>
  value === null ? "n/a" : `${String(value.low)} to ${String(value.high)}`;

const row = (bucket: Bucket): string =>
  bucket.suppressed
    ? `| ${bucket.period} | suppressed (fewer than k contributors) | | | | | | |`
    : `| ${bucket.period} | ${String(bucket.commits)} | ${String(bucket.tasks)} | ${String(bucket.falseDone)} | ${String(bucket.firstTry)} (${interval(bucket.firstTryRate)}) | ${String(bucket.rework)} | ${String(bucket.reverts)} | ${bucket.spendMedianUsd === null ? "n/a" : `$${String(bucket.spendMedianUsd)} (${String(bucket.spendTasks)} tasks)`} |`;

export const renderReport = (report: TeamReport): readonly string[] => [
  "# Team report",
  "",
  `Aggregated per repository and month. No person is named; a month with fewer than ${String(report.k)} contributors is suppressed.`,
  "",
  "| Period | Commits | Tasks | False done | First try (95% interval) | Rework | Reverts | Spend per task (median) |",
  "|---|---|---|---|---|---|---|---|",
  ...report.buckets.map(row),
  "",
  "## Method",
  "",
  ...report.method.map((line) => `- ${line.metric}: ${line.definition}. Source: ${line.source}.`),
];
