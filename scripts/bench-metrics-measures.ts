import type { JsonObject } from "../src/core/parsed.js";
import {
  armOf,
  booleanAt,
  eventsOf,
  type MetricsInput,
  numberAt,
  RUN_LOG,
  type RunRow,
  RUNS_FILE,
  secondsAt,
} from "./bench-metrics-read.js";

export const ROLES = ["confirmatory", "exploratory"] as const;
export type Role = (typeof ROLES)[number];

export interface Sample {
  readonly group: string;
  readonly value: number;
}

interface MeasureBase {
  readonly id: string;
  readonly issues: readonly number[];
  readonly title: string;
  readonly role: Role;
}

export interface ComputedMeasure extends MeasureBase {
  readonly unit: string;
  readonly aggregate: "median" | "mean";
  readonly source: string;
  readonly needs: string;
  readonly samples: (input: MetricsInput) => readonly Sample[];
}

export interface LocalGap extends MeasureBase {
  readonly reason: string;
}

export type Measure = ComputedMeasure | LocalGap;

const total = (record: JsonObject): number | undefined => {
  const input = numberAt(record, "inputTokens");
  const output = numberAt(record, "outputTokens");
  return input === undefined || output === undefined ? undefined : input + output;
};

const perRun =
  (read: (row: RunRow, input: MetricsInput) => Sample | undefined) =>
  (input: MetricsInput): readonly Sample[] =>
    input.runs.flatMap((row) => {
      const sample = read(row, input);
      return sample === undefined ? [] : [sample];
    });

const byArm =
  (read: (record: JsonObject) => number | undefined) =>
  (row: RunRow): Sample | undefined => {
    const value = read(row.record);
    return value === undefined ? undefined : { group: armOf(row), value };
  };

const flag = (value: boolean | undefined): number | undefined => (value === undefined ? undefined : value ? 1 : 0);

const approvalSeconds = (row: RunRow): readonly Sample[] => {
  const pairs: readonly (readonly [string, string, string])[] = [
    ["ui.proposed", "ui.approved", "task"],
    ["journey.proposed", "journey.approved", "name"],
  ];
  return pairs.flatMap(([proposed, approved, key]) =>
    eventsOf(row, approved).flatMap((done) => {
      const start = eventsOf(row, proposed).find((item) => item[key] === done[key] && item["hash"] === done["hash"]);
      const from = start === undefined ? undefined : secondsAt(start);
      const to = secondsAt(done);
      return from === undefined || to === undefined || to < from ? [] : [{ group: armOf(row), value: to - from }];
    }),
  );
};

const RUN_MEASURES: readonly ComputedMeasure[] = [
  {
    id: "tokens-per-task",
    issues: [273, 283],
    title: "Tokens per task (input plus output)",
    role: "exploratory",
    unit: "tokens",
    aggregate: "median",
    source: RUNS_FILE,
    needs: "inputTokens and outputTokens",
    samples: perRun(byArm(total)),
  },
  {
    id: "time-per-task",
    issues: [285],
    title: "Wall time per task",
    role: "exploratory",
    unit: "s",
    aggregate: "median",
    source: RUNS_FILE,
    needs: "durationMs",
    samples: perRun(
      byArm((record) => {
        const ms = numberAt(record, "durationMs");
        return ms === undefined ? undefined : ms / 1000;
      }),
    ),
  },
  {
    id: "false-done-by-size",
    issues: [288],
    title: "False done rate per arm and task size class",
    role: "exploratory",
    unit: "rate",
    aggregate: "mean",
    source: RUNS_FILE,
    needs: "falseDone and a family with a size in bench/tasks",
    samples: perRun((row, input) => {
      const family = row.record["family"];
      const size = typeof family === "string" ? input.sizes[family] : undefined;
      const value = flag(booleanAt(row.record, "falseDone"));
      return size === undefined || value === undefined ? undefined : { group: `${armOf(row)} ${size}`, value };
    }),
  },
  {
    id: "false-done-by-arm",
    issues: [299],
    title: "False done rate per arm (the x-ray arms A0 to A3 report here once their arm files exist)",
    role: "exploratory",
    unit: "rate",
    aggregate: "mean",
    source: RUNS_FILE,
    needs: "falseDone",
    samples: perRun(byArm((record) => flag(booleanAt(record, "falseDone")))),
  },
  {
    id: "tokens-per-turn",
    issues: [310],
    title: "Tokens per turn",
    role: "exploratory",
    unit: "tokens",
    aggregate: "median",
    source: RUNS_FILE,
    needs: "inputTokens, outputTokens and turns",
    samples: perRun(
      byArm((record) => {
        const tokens = total(record);
        const turns = numberAt(record, "turns");
        return tokens === undefined || turns === undefined || turns <= 0 ? undefined : tokens / turns;
      }),
    ),
  },
  {
    id: "cost-per-task",
    issues: [326],
    title: "Cost per task",
    role: "exploratory",
    unit: "USD",
    aggregate: "median",
    source: RUNS_FILE,
    needs: "costUsd",
    samples: perRun(byArm((record) => numberAt(record, "costUsd"))),
  },
];

const LOG_MEASURES: readonly ComputedMeasure[] = [
  {
    id: "oracle-green-after-question",
    issues: [289],
    title: "Oracle green rate in runs with an answered divergence question against runs without",
    role: "exploratory",
    unit: "rate",
    aggregate: "mean",
    source: `${RUNS_FILE} + ${RUN_LOG}`,
    needs: "oracleGreen and divergence.answered events",
    samples: perRun((row) => {
      const value = flag(booleanAt(row.record, "oracleGreen"));
      const asked = eventsOf(row, "divergence.answered").length > 0;
      return value === undefined ? undefined : { group: `${armOf(row)} ${asked ? "asked" : "not asked"}`, value };
    }),
  },
  {
    id: "time-to-approval",
    issues: [300],
    title: "Seconds from a proposed UI contract or journey to its approval",
    role: "exploratory",
    unit: "s",
    aggregate: "median",
    source: RUN_LOG,
    needs: "ui.proposed/ui.approved or journey.proposed/journey.approved events",
    samples: (input) => input.runs.flatMap(approvalSeconds),
  },
  {
    id: "probe-right-rate",
    issues: [301],
    title: "Share of answered probes the person got right, per probe kind (V1 to V3)",
    role: "exploratory",
    unit: "rate",
    aggregate: "mean",
    source: RUN_LOG,
    needs: "probe.result events with status right or wrong",
    samples: (input) =>
      input.runs.flatMap((row) =>
        eventsOf(row, "probe.result").flatMap((event) => {
          const { status, kind } = event;
          if (status !== "right" && status !== "wrong") return [];
          return [
            {
              group: `${armOf(row)} ${typeof kind === "string" ? kind : "unknown"}`,
              value: status === "right" ? 1 : 0,
            },
          ];
        }),
      ),
  },
  {
    id: "mutation-kill-rate",
    issues: [335],
    title: "Mutation score (share of mutants killed) per arm",
    role: "exploratory",
    unit: "rate",
    aggregate: "median",
    source: RUN_LOG,
    needs: "mutation.score events",
    samples: (input) =>
      input.runs.flatMap((row) =>
        eventsOf(row, "mutation.score").flatMap((event) => {
          const score = numberAt(event, "score");
          return score === undefined ? [] : [{ group: armOf(row), value: score }];
        }),
      ),
  },
  {
    id: "security-findings",
    issues: [342],
    title: "Quality and security findings per run with a gate log",
    role: "exploratory",
    unit: "findings",
    aggregate: "median",
    source: RUN_LOG,
    needs: "a non-empty run log; quality.findings events are summed",
    samples: perRun((row) =>
      row.log.length === 0
        ? undefined
        : {
            group: armOf(row),
            value: eventsOf(row, "quality.findings").reduce(
              (sum, event) => sum + (numberAt(event, "block") ?? 0) + (numberAt(event, "warn") ?? 0),
              0,
            ),
          },
    ),
  },
];

const GAPS: readonly LocalGap[] = [
  {
    id: "file-edited-next",
    issues: [311],
    title: "Returned file edited again in the next session",
    role: "exploratory",
    reason:
      "needs the next session in the same repository; every bench run is one fresh work folder with one session, so there is no next session to look at",
  },
  {
    id: "plan-time",
    issues: [328],
    title: "Time spent in the infra plan gate",
    role: "exploratory",
    reason:
      "the plan gate writes no start or end time to the local log, and no bench task runs an infrastructure plan; it needs a timing event and an infra task first",
  },
  {
    id: "review-time",
    issues: [342],
    title: "Time to review a pull request",
    role: "exploratory",
    reason: "needs the review timestamps of a pull request on the forge; bench runs do not open pull requests",
  },
  {
    id: "draft-lines",
    issues: [124],
    title: "Drafted command lines that match the commands the person confirms",
    role: "exploratory",
    reason:
      "needs the commands a person confirms after onboarding; the bench self-report onboarding drafts no command lines to compare",
  },
];

export const MEASURES: readonly Measure[] = [...RUN_MEASURES, ...LOG_MEASURES, ...GAPS];

export const isComputed = (measure: Measure): measure is ComputedMeasure => "samples" in measure;
