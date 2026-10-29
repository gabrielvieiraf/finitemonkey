import type { Note } from "../evidence/types.js";
import { catalogs, type MessageKey } from "../i18n/catalogs.js";
import type { Translate } from "../i18n/translate.js";
import { maskText } from "../mask/mask.js";
import type { GateReport, ReportItem } from "./report.js";

const STATUS_KEYS = {
  passed: "gate.status.passed",
  failed: "gate.status.failed",
  unverified: "gate.status.unverified",
} as const satisfies Readonly<Record<ReportItem["status"], MessageKey>>;

export const isMessageKey = (key: string): key is MessageKey => key in catalogs.en;

export const noteText = (t: Translate, item: Note): string =>
  maskText(isMessageKey(item.key) ? t(item.key, item.params) : item.key);

const reasonText = (t: Translate, item: ReportItem): readonly string[] =>
  item.status === "unverified" &&
  item.notes.length === 0 &&
  item.reason !== undefined &&
  isMessageKey(`gate.reason.${item.reason}`)
    ? [t(`gate.reason.${item.reason}` as MessageKey)]
    : [];

export const itemDetails = (t: Translate, item: ReportItem): readonly string[] => [
  ...item.notes.map((entry) => noteText(t, entry)),
  ...reasonText(t, item),
];

const label = (item: ReportItem): string =>
  item.command === undefined ? item.kind : `${item.kind} \`${maskText(item.command)}\``;

export const reportLines = (t: Translate, report: GateReport): readonly string[] => {
  const width = Math.max(...Object.values(STATUS_KEYS).map((key) => t(key).length)) + 2;
  return [
    t(report.implicit ? "gate.report.title_implicit" : "gate.report.title", {
      task: report.task,
      tree: report.treeHash,
    }),
    ...(report.contractEdited ? [`  ${t("gate.report.contract_edited")}`] : []),
    ...(report.tampered > 0 ? [`  ${t("gate.report.tampered", { count: report.tampered })}`] : []),
    ...report.items.flatMap((item) => [
      `  ${t(STATUS_KEYS[item.status]).padEnd(width)}${item.id}  ${label(item)}`,
      ...itemDetails(t, item).map((line) => `  ${" ".repeat(width)}  ${line}`),
    ]),
    t(`gate.verdict.${report.verdict}`, report.counts),
    groupsLine(t, report),
  ];
};

const ids = (items: readonly ReportItem[]): string => items.map((item) => item.id).join(", ") || "-";

export const groupsLine = (t: Translate, report: GateReport): string =>
  t("gate.report.groups", {
    state: report.state,
    verified: ids(report.items.filter((item) => item.status === "passed")),
    unverified: ids(report.items.filter((item) => item.status === "unverified" && !item.stale)),
    invalidated: ids(report.items.filter((item) => item.stale)),
  });

const REQUIRE_KEYS: Readonly<Record<string, MessageKey>> = {
  command: "gate.require.command",
  tests: "gate.require.tests",
  diff: "gate.require.diff",
  placeholders: "gate.require.placeholders",
  git: "gate.require.git",
  pr: "gate.require.pr",
  manual: "gate.require.manual",
  secrets: "gate.require.secrets",
  worktree: "gate.require.worktree",
  merge: "gate.require.merge",
};

const requirement = (t: Translate, item: ReportItem): string =>
  `${item.id} ${t(REQUIRE_KEYS[item.kind] ?? "gate.require.other", { command: maskText(item.command ?? item.kind), kind: item.kind })}`;

const CLAIM_MAX = 120;

const claimOf = (message: string | undefined): string => {
  const first = maskText((message ?? "").trim().split(/\n/)[0] ?? "");
  return first.length > CLAIM_MAX ? `${first.slice(0, CLAIM_MAX)}…` : first;
};

export const blockReason = (t: Translate, report: GateReport, lastMessage: string | undefined): string => {
  const failing = report.items.filter((item) => item.status === "failed");
  return [
    t("gate.model.title", { task: report.task, tree: report.treeHash }),
    t("gate.model.claim", { claim: claimOf(lastMessage) || t("gate.model.no_claim") }),
    t("gate.model.requires", { list: failing.map((item) => requirement(t, item)).join("; ") }),
    t("gate.model.not_enough", {
      list: failing.map((item) => `${item.id}: ${itemDetails(t, item).join(", ")}`).join("; "),
    }),
  ].join("\n");
};

export const unverifiedSummary = (t: Translate, report: GateReport): string =>
  report.items
    .filter((item) => item.status === "unverified")
    .map((item) => `${item.id} (${itemDetails(t, item).join(", ") || t("gate.reason.no_evidence")})`)
    .join("; ");

const verifyStep = (t: Translate, report: GateReport, item: ReportItem): string => {
  if (item.reason === "awaiting_person" || item.reason === "untrusted" || item.reason === "needs_approval")
    return t("gate.verify.person");
  if (item.reason === "no_gh") return t("gate.verify.gh", { task: report.task });
  if (item.command !== undefined && item.reason !== "rewriter") return `\`${maskText(item.command)}\``;
  return t("gate.verify.rerun", { task: report.task });
};

export const holdReason = (t: Translate, report: GateReport): string => {
  const open = report.items.filter((item) => item.status === "unverified");
  return [
    t("gate.model.unverified_title", { task: report.task, tree: report.treeHash, state: report.state }),
    t("gate.model.not_verified", {
      list: open
        .map((item) => `${item.id}: ${itemDetails(t, item).join(", ") || t("gate.reason.no_evidence")}`)
        .join("; "),
    }),
    t("gate.model.verify", { list: open.map((item) => `${item.id}: ${verifyStep(t, report, item)}`).join("; ") }),
  ].join("\n");
};
