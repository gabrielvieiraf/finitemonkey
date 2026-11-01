import { type Analysis, type ArmTotals, bundleDecision, guardrails, primaryVerdict } from "./bench-people-analysis.js";
import type { PairedEstimate } from "./bench-people-stats.js";

export interface ReportInput {
  readonly analysis: Analysis;
  readonly hashes: Readonly<Record<string, string>>;
}

export const SYNTHETIC_BANNER =
  "> SYNTHETIC FIXTURE DATA. These records were constructed to test the analysis code. They are not from real participants and must never be cited as results.";

const REAL_BANNER = "> Real sessions, analysed with the pre-registered plan in docs/bench/people.md.";

const fixed = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : "-");

const table = (header: readonly string[], rows: readonly (readonly string[])[]): readonly string[] => [
  `| ${header.join(" | ")} |`,
  `|${header.map(() => "---").join("|")}|`,
  ...rows.map((row) => `| ${row.join(" | ")} |`),
];

const totalsRow = (label: string, totals: ArmTotals): readonly string[] => [
  label,
  totals.arm,
  String(totals.sessions),
  String(totals.claimedDone),
  String(totals.oracleGreen),
  String(totals.falseDone),
  `${String(totals.trapGreen)}/${String(totals.trapTotal)}`,
  fixed(totals.medianWallMinutes, 1),
  `${String(totals.tokens)} (${String(totals.tokenSessions)} sessions)`,
];

const TOTALS_HEADER = [
  "Group",
  "Arm",
  "Sessions",
  "Claimed done",
  "Oracle green",
  "False done",
  "Trap green",
  "Median minutes",
  "Tokens",
];

const interval = (estimate: PairedEstimate | undefined, scale: (value: number) => number, digits: number): string =>
  estimate === undefined
    ? "-"
    : `${fixed(scale(estimate.estimate), digits)} [${fixed(scale(estimate.low), digits)}, ${fixed(scale(estimate.high), digits)}] (n = ${String(estimate.n)})`;

const same = (value: number): number => value;

const enrollment = (analysis: Analysis): readonly string[] => {
  const withdrawn = analysis.enrolled.filter((person) => person.withdrawn).map((person) => person.participant);
  return [
    "## Enrollment",
    "",
    `- Enrolled: ${String(analysis.enrolled.length)} (${analysis.enrolled.map((person) => person.participant).join(", ") || "none"})`,
    `- Withdrawn: ${String(withdrawn.length)}${withdrawn.length > 0 ? ` (${withdrawn.join(", ")})` : ""}`,
    `- Analysed, with sessions in both arms: ${String(analysis.analysed.length)}`,
    `- Not analysed, missing an arm: ${analysis.incomplete.join(", ") || "none"}`,
    `- Scheduled sessions not recorded: ${analysis.missing.join(", ") || "none"}`,
    `- Sessions run in the other arm (counted in the assigned arm): ${analysis.deviations.map((s) => `${s.participant}/${s.task}`).join(", ") || "none"}`,
  ];
};

const effects = (analysis: Analysis): readonly string[] => [
  "## Primary: false done",
  "",
  "Per participant, the false done rate with Finite Monkey minus the rate without it. Mean, 95% t interval, and the exact sign-flip p over every sign assignment.",
  "",
  `- Difference: ${interval(analysis.primary, same, 3)}`,
  `- Sign-flip p: ${analysis.primaryP === undefined ? "-" : fixed(analysis.primaryP, 4)}`,
  `- Verdict: ${primaryVerdict(analysis.primary)}`,
  "",
  "## Guardrails",
  "",
  `- Completion difference (oracle green rate, fm minus plain): ${interval(analysis.completion, same, 3)}`,
  `- Wall time ratio (fm over plain, geometric): ${interval(analysis.logWall, Math.exp, 2)}`,
  ...guardrails(analysis).map(
    (rail) =>
      `- ${rail.name}: ${rail.breached === undefined ? "not enough data" : rail.breached ? "BREACHED" : "held"}`,
  ),
  "",
  `Decision on the Finite Monkey bundle: ${bundleDecision(analysis)}`,
];

const belief = (analysis: Analysis): readonly string[] => [
  "## Belief against measurement",
  "",
  ...table(
    ["Participant", "Perceived speedup %", "Measured speedup %", "Gap"],
    analysis.belief.map((row) => [
      row.participant,
      row.perceived === null ? "-" : fixed(row.perceived, 0),
      fixed(row.measured, 0),
      row.perceived === null ? "-" : fixed(row.perceived - row.measured, 0),
    ]),
  ),
];

const features = (analysis: Analysis): readonly string[] => [
  "## Features in the fm arm",
  "",
  ...table(
    ["Feature", "Sessions shown", "Times shown", "Dismissed", "Verdict"],
    analysis.features.map((row) => [
      row.feature,
      String(row.sessions),
      String(row.shown),
      String(row.dismissed),
      row.verdict,
    ]),
  ),
];

const raw = (analysis: Analysis): readonly string[] => [
  "## Every session",
  "",
  ...table(
    [
      "Participant",
      "Task",
      "Assigned",
      "Ran",
      "Claimed done",
      "Oracle green",
      "Trap green",
      "Minutes",
      "Tokens",
      "Stopped",
    ],
    analysis.sessions.map((s) => [
      s.participant,
      s.task,
      s.assigned,
      s.ran,
      String(s.claimedDone),
      String(s.oracleGreen),
      s.trapGreen === null ? "-" : String(s.trapGreen),
      fixed(s.wallSeconds / 60, 1),
      s.tokens === null ? "-" : String(s.tokens),
      s.stopped,
    ]),
  ),
];

export const renderReport = ({ analysis, hashes }: ReportInput): string =>
  [
    "# People study report",
    "",
    analysis.synthetic ? SYNTHETIC_BANNER : REAL_BANNER,
    "",
    ...Object.entries(hashes).map(([file, hash]) => `- sha256 of ${file}: \`${hash}\``),
    "",
    ...enrollment(analysis),
    "",
    "## Raw counts",
    "",
    ...table(TOTALS_HEADER, [
      ...analysis.totals.map((totals) => totalsRow("all", totals)),
      ...analysis.byProfile.flatMap(({ profile, totals }) => totals.map((item) => totalsRow(profile, item))),
    ]),
    "",
    ...effects(analysis),
    "",
    ...belief(analysis),
    "",
    ...features(analysis),
    "",
    ...raw(analysis),
    "",
  ].join("\n");
