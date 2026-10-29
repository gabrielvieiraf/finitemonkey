import { textField } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import type { Translate } from "../../i18n/translate.js";
import { featureMode, recordFeatureShadow } from "../../policy/feature.js";
import { sha256Hex as sha256 } from "../../secrets/fingerprint.js";
import { fmPaths } from "../../task/paths.js";
import { closeTask, readState, writeState } from "../../task/state.js";
import { gitAt, treeHash } from "../git.js";
import type { IsolatedFailure } from "../isolated.js";
import type { GateFailure } from "../prepare.js";
import { blockReason, holdReason, itemDetails, unverifiedSummary } from "../render.js";
import type { GateReport } from "../report.js";
import { recordReview, REVIEWER_AGENT } from "../review.js";
import { type GateRun, runGate } from "../run.js";
import { canClose } from "../state.js";
import { allowWith, findRepoRoot, gateBudget, human, sessionCwd } from "./common.js";
import { nextBlock, readCounter, saveCounter } from "./counter.js";
import { writeGateStatus } from "./status.js";

const failureDetail = (
  t: Translate,
  failure: GateFailure | IsolatedFailure | { readonly kind: "ledger_unwritable" },
): string => {
  switch (failure.kind) {
    case "not_a_repo":
      return t("gate.fail.not_a_repo");
    case "no_tree_hash":
      return t("gate.fail.no_tree_hash");
    case "ledger_unwritable":
      return t("gate.fail.ledger_unwritable");
    case "contract":
      return t(failure.problem.kind === "not_found" ? "gate.fail.contract_missing" : "gate.fail.contract_invalid", {
        task: failure.problem.id,
        issues: failure.problem.kind === "invalid" ? failure.problem.issues.join("; ") : "",
      });
    case "isolated":
      return t("gate.fail.isolated", { step: failure.step, detail: failure.detail });
  }
};

const failingList = (t: Translate, report: GateReport): string =>
  report.items
    .filter((item) => item.status === "failed")
    .map((item) => `${item.id} (${itemDetails(t, item).join(", ")})`)
    .join("; ");

const touchesTests = (report: GateReport): boolean =>
  report.items.some(
    (item) => item.status === "failed" && item.notes.some((entry) => entry.key.startsWith("gate.tests.")),
  );

export const HOLD_FEATURE = "gate-hold";

const markDone = (input: HookInput, report: GateReport, root: ReturnType<typeof fmPaths>): void => {
  if (report.implicit || !canClose(report.state)) return;
  const state = readState(input.runtime, root);
  if (state.active !== report.task) return;
  writeState(input.runtime, root, closeTask(state, report.task));
};

const onFailed = (input: HookInput, report: GateReport, paths: ReturnType<typeof fmPaths>): HookDecision => {
  const { t, runtime, env } = input;
  const verdict = nextBlock(readCounter(runtime, paths), report, env);
  if (verdict.kind === "exhausted") {
    saveCounter(runtime, paths, undefined);
    writeGateStatus(runtime, paths, {
      status: "not_done",
      task: report.task,
      detail: failingList(t, report),
      state: report.state,
    });
    return allowWith({
      systemMessage: human(t("gate.human.not_done", { blocks: verdict.blocks, list: failingList(t, report) })),
    });
  }
  saveCounter(runtime, paths, verdict.counter);
  writeGateStatus(runtime, paths, {
    status: "failed",
    task: report.task,
    detail: failingList(t, report),
    state: report.state,
  });
  const reason = blockReason(t, report, textField(input.payload.raw, "last_assistant_message"));
  const message = [
    t("gate.human.held", { count: report.counts.failed }),
    ...(touchesTests(report) ? [t("gate.human.witness")] : []),
  ];
  return {
    kind: "block",
    reason,
    persistent: true,
    output: { decision: "block", reason, systemMessage: human(message.join(" ")) },
  };
};

const holdSignature = (report: GateReport): string =>
  sha256(
    JSON.stringify([
      "unverified",
      report.treeHash,
      report.items.filter((item) => item.status === "unverified").map((item) => [item.id, item.reason ?? ""]),
    ]),
  );

const onIncomplete = (input: HookInput, report: GateReport, paths: ReturnType<typeof fmPaths>): HookDecision => {
  const { t, runtime } = input;
  const list = unverifiedSummary(t, report);
  writeGateStatus(runtime, paths, { status: "incomplete", task: report.task, detail: list, state: report.state });
  const passOn = allowWith({ systemMessage: human(t("gate.human.incomplete", { list })) });
  const signature = holdSignature(report);
  const previous = readCounter(runtime, paths);
  const mode = featureMode(runtime, paths, HOLD_FEATURE);
  if (mode === "off" || (previous?.task === report.task && previous.signature === signature)) {
    saveCounter(runtime, paths, undefined);
    return passOn;
  }
  if (mode === "shadow") {
    saveCounter(runtime, paths, undefined);
    recordFeatureShadow(runtime, paths, HOLD_FEATURE, { task: report.task, state: report.state, wouldHave: "block" });
    return passOn;
  }
  saveCounter(runtime, paths, { task: report.task, signature, consecutive: 1, same: 1 });
  const reason = holdReason(t, report);
  return {
    kind: "block",
    reason,
    persistent: true,
    output: {
      decision: "block",
      reason,
      systemMessage: human(t("gate.human.held_unverified", { count: report.counts.unverified, list })),
    },
  };
};

const onReport = (input: HookInput, report: GateReport, paths: ReturnType<typeof fmPaths>): HookDecision => {
  const { t, runtime } = input;
  if (report.verdict === "failed") return onFailed(input, report, paths);
  if (report.verdict === "incomplete") return onIncomplete(input, report, paths);
  saveCounter(runtime, paths, undefined);
  writeGateStatus(runtime, paths, { status: "passed", task: report.task, detail: "", state: report.state });
  markDone(input, report, paths);
  return allowWith({ systemMessage: human(t("gate.human.passed", { count: report.counts.passed })) });
};

const conclude = (input: HookInput, run: GateRun): HookDecision => {
  const { t, runtime } = input;
  if (run.kind === "skipped") return { kind: "allow" };
  const root = findRepoRoot(runtime, sessionCwd(input));
  if (root === undefined)
    return allowWith({ systemMessage: human(t("gate.human.not_run", { detail: t("gate.fail.not_a_repo") })) });
  const paths = fmPaths(root);
  if (run.kind === "done") return onReport(input, run.report, paths);
  const detail = failureDetail(t, run.failure);
  writeGateStatus(runtime, paths, { status: "not_run", task: "", detail });
  return allowWith({ systemMessage: human(t("gate.human.not_run", { detail })) });
};

const safeRun = (input: HookInput): GateRun | { readonly kind: "crashed"; readonly detail: string } => {
  try {
    return runGate({
      runtime: input.runtime,
      cwd: sessionCwd(input),
      env: input.env,
      sessionId: input.payload.sessionId,
      budgetMs: gateBudget(input),
      fast: true,
    });
  } catch (error) {
    return { kind: "crashed", detail: error instanceof Error ? error.message : String(error) };
  }
};

export const stopGate: HookHandler = (input) => {
  const run = safeRun(input);
  if (run.kind !== "crashed") return conclude(input, run);
  return allowWith({ systemMessage: human(input.t("gate.human.not_run", { detail: run.detail })) });
};

const isOwnWorktree = (input: HookInput): boolean => {
  if (input.payload.cwd === undefined) return false;
  const runtime = input.runtime;
  const front = findRepoRoot(runtime, sessionCwd(input));
  const main = findRepoRoot(runtime, input.cwd);
  return front !== undefined && main !== undefined && front !== main;
};

const noteReview = (input: HookInput): void => {
  const agent = textField(input.payload.raw, "agent_type") ?? "";
  if (!REVIEWER_AGENT.test(agent)) return;
  const root = findRepoRoot(input.runtime, sessionCwd(input));
  if (root === undefined) return;
  const tree = treeHash(gitAt(input.runtime, root));
  if (tree !== undefined) recordReview(input.runtime, fmPaths(root), tree, agent);
};

export const subagentStopGate: HookHandler = (input) => {
  noteReview(input);
  return isOwnWorktree(input) ? stopGate(input) : { kind: "allow" };
};
