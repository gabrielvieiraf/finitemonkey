import { dirname, join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { nowMs } from "../../core/clock.js";
import { type JsonObject, parseJsonObject } from "../../core/parsed.js";
import type { Note } from "../../evidence/types.js";
import { configAt, configList, type ConfigTree, loadProjectConfig } from "../../git/project-config.js";
import {
  INFRA_FILE,
  MANIFEST_FILE,
  manifestResources,
  type PlanFinding,
  readPlan,
  removedStateful,
  touchesInfra,
} from "../../infra/plan-gate.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { fileAt } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

export const INFRA_PLAN_FEATURE = "infra-plan";
const PLAN_TIMEOUT_MS = 300_000;
const DETAIL_LIMIT = 300;
const MAX_LISTED = 12;

type Plans =
  | { readonly kind: "plans"; readonly plans: readonly JsonObject[] }
  | { readonly kind: "not_verified"; readonly detail: string };

const terraform = (ctx: GateContext, args: readonly string[]) =>
  ctx.runtime.exec({
    command: "terraform",
    args,
    cwd: ctx.paths.root,
    timeoutMs: Math.max(1_000, Math.min(PLAN_TIMEOUT_MS, ctx.deadline - nowMs(ctx.runtime))),
    env: { TF_IN_AUTOMATION: "1", TF_INPUT: "0" },
  });

const planDir = (ctx: GateContext, dir: string, index: number): JsonObject | string => {
  const out = ctx.paths.cache(`infra-plan-${String(index)}.tfplan`);
  const chdir = `-chdir=${dir === "" ? "." : dir}`;
  const planned = terraform(ctx, [chdir, "plan", "-input=false", "-lock=false", "-no-color", `-out=${out}`]);
  if (!planned.found) return "terraform not installed";
  if (planned.exitCode !== 0 || planned.timedOut) return (planned.stderr || planned.stdout).trim().slice(-DETAIL_LIMIT);
  const shown = terraform(ctx, [chdir, "show", "-no-color", "-json", out]);
  const parsed = shown.exitCode === 0 ? parseJsonObject(shown.stdout) : undefined;
  return parsed?.ok === true ? parsed.value : "terraform show -json did not return a plan";
};

const terraformPlans = (ctx: GateContext, config: ConfigTree, dirs: readonly string[]): Plans => {
  const file = configAt(config, "infra_plan", "plan_json");
  if (typeof file === "string" && file !== "") {
    const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, file)));
    const parsed = text.ok ? parseJsonObject(text.value) : undefined;
    return parsed?.ok === true ? { kind: "plans", plans: [parsed.value] } : { kind: "not_verified", detail: file };
  }
  const plans: JsonObject[] = [];
  for (const [index, dir] of dirs.entries()) {
    const plan = planDir(ctx, dir, index);
    if (typeof plan === "string") return { kind: "not_verified", detail: `${dir === "" ? "." : dir}: ${plan}` };
    plans.push(plan);
  }
  return { kind: "plans", plans };
};

const manifestFindings = (ctx: GateContext): readonly PlanFinding[] =>
  ctx.changes
    .filter((change) => MANIFEST_FILE.test(change.oldPath ?? change.path))
    .flatMap((change) => {
      const before = fileAt(ctx.git, ctx.base, change.oldPath ?? change.path) ?? "";
      const now =
        change.status === "D" ? undefined : ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, change.path)));
      return removedStateful(manifestResources(before), manifestResources(now?.ok === true ? now.value : ""));
    });

const criteriaText = (ctx: GateContext): string =>
  ctx.contract.acceptance.map((check) => `${check.id} ${check.description ?? ""}`).join("\n");

const allowed = (ctx: GateContext, config: ConfigTree) => {
  const ephemeral = configAt(config, "infra_plan", "ephemeral") === "true";
  const criteria = criteriaText(ctx);
  return (finding: PlanFinding): boolean => {
    if (finding.kind !== "stateful-destroy") return false;
    const address = finding.subject.split(" ")[0] ?? "";
    return ephemeral || (address !== "" && criteria.includes(address));
  };
};

const infraDirs = (ctx: GateContext): readonly string[] => [
  ...new Set(
    ctx.changes
      .filter((change) => INFRA_FILE.test(change.path) || INFRA_FILE.test(change.oldPath ?? ""))
      .map((change) => dirname(change.path).replace(/^\.$/, "")),
  ),
];

const shadowed = (mode: string, outcome: CheckOutcome, notes: readonly Note[]): CheckOutcome =>
  mode === "shadow" ? passed([note("gate.infra_plan.shadow"), ...notes]) : outcome;

export const infraPlanCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, INFRA_PLAN_FEATURE);
  if (mode === "off") return passed([note("gate.infra_plan.off")]);
  const dirs = infraDirs(ctx);
  const touched = touchesInfra(ctx.changes.flatMap((change) => [change.path, change.oldPath ?? ""]));
  if (!touched) return passed([note("gate.infra_plan.none")]);
  const config = loadProjectConfig(ctx.runtime, ctx.paths.root);
  const plans: Plans = dirs.length === 0 ? { kind: "plans", plans: [] } : terraformPlans(ctx, config, dirs);
  if (plans.kind === "not_verified") {
    const notes = [note("gate.infra_plan.not_verified", { detail: plans.detail })];
    return shadowed(mode, unverified("tool_missing", notes), notes);
  }
  const summaries = plans.plans.map((plan) => readPlan(plan, configList(config, "infra_plan", "stateful")));
  const counts = summaries.reduce(
    (total, summary) => ({
      create: total.create + summary.counts.create,
      update: total.update + summary.counts.update,
      delete: total.delete + summary.counts.delete,
      replace: total.replace + summary.counts.replace,
    }),
    { create: 0, update: 0, delete: 0, replace: 0 },
  );
  const isAllowed = allowed(ctx, config);
  const findings = [...summaries.flatMap((summary) => summary.findings), ...manifestFindings(ctx)];
  const open = findings.filter((finding) => !isAllowed(finding));
  const countNote = note("gate.infra_plan.counts", counts);
  const accepted = findings
    .filter(isAllowed)
    .map((finding) => note("gate.infra_plan.accepted", { subject: finding.subject }));
  if (open.length === 0) return passed([countNote, ...accepted]);
  const notes = open
    .slice(0, MAX_LISTED)
    .map((finding) => note(`gate.infra_plan.${finding.kind}`, { subject: finding.subject }));
  return shadowed(mode, failed([countNote, ...notes]), [countNote, ...notes]);
};
