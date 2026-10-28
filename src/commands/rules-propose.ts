import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { lineReader } from "../perfil/lines.js";
import { policyNumber } from "../policy/numbers.js";
import { effectiveRules } from "../rules/preset.js";
import { buildProposals, confirmable, DEFAULT_PROMOTE_AFTER, type Proposal } from "../rules/propose.js";
import { RULES_FILE } from "../rules/types.js";
import { readViolations, recordViolation } from "../rules/violations.js";
import { withNewRules, withPromotion } from "../rules/write.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import { FM_DIR } from "../task/paths.js";
import { projectInventory } from "./instructions.js";
import type { CommandSpec } from "./types.js";

export const RULES_PROPOSE_SCHEMA = "finitemonkey/rules-propose@1";
const YES = new Set(["y", "yes", "s", "sim", "si", "sí"]);

const fmDir = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, FM_DIR));

const detectorText = (proposal: Proposal): string => {
  const detector = proposal.detector;
  if (detector === undefined) return "-";
  return detector === "attribution" ? "attribution" : JSON.stringify(detector);
};

export const proposalLines = (ctx: Pick<Ctx, "t">, proposal: Proposal): readonly string[] => [
  ctx.t(proposal.kind === "new" ? "rules.propose.row" : "rules.propose.promote", {
    id: proposal.id,
    bucket: proposal.bucket,
    severity: proposal.severity,
    origin: proposal.origin,
    text: proposal.text,
    detector: detectorText(proposal),
    count: proposal.evidence.length,
  }),
  ...proposal.evidence.map((item) => `    ${item.at} ${item.source}: ${item.detail}`),
  ...(confirmable(proposal) ? [] : [ctx.t("rules.propose.needs_detector", { id: proposal.id })]),
];

const ask = async (ctx: Ctx, proposals: readonly Proposal[]): Promise<readonly Proposal[]> => {
  if (ctx.yes) return proposals.filter(confirmable);
  const next = lineReader(ctx.io.stdin);
  const accepted: Proposal[] = [];
  for (const proposal of proposals.filter(confirmable)) {
    ctx.io.stderr.write(`${[...proposalLines(ctx, proposal), ctx.t("rules.propose.ask")].join("\n")} `);
    const answer = (await next())?.trim().toLowerCase();
    if (answer === undefined) break;
    if (YES.has(answer)) accepted.push(proposal);
  }
  return accepted;
};

const applied = (current: string | undefined, accepted: readonly Proposal[]): Parsed<string> => {
  const added = withNewRules(
    current,
    accepted.filter((item) => item.kind === "new"),
  );
  if (!added.ok) return added;
  let text = added.value;
  for (const proposal of accepted.filter((item) => item.kind === "promote")) {
    const promoted = withPromotion(text, proposal);
    if (!promoted.ok) return reject(promoted.error);
    text = promoted.value;
  }
  return accept(text);
};

const writeAccepted = (ctx: Ctx, root: AbsolutePath, accepted: readonly Proposal[]): Parsed<true> => {
  const path = toAbsolutePath(RULES_FILE, root);
  const current = ctx.runtime.readText(path);
  const next = applied(current.ok ? current.value : undefined, accepted);
  if (!next.ok) return next;
  ctx.runtime.mkdir(fmDir(root));
  return ctx.runtime.writeText(path, next.value);
};

const invalid = (ctx: Ctx, detail: string): CommandResult =>
  failureFrom(
    ctx.t,
    usageProblem("invalid_arguments", "rules.error.invalid", `edit ${RULES_FILE}`, { file: RULES_FILE, detail }),
  );

export const rulesProposeCommand: CommandSpec = {
  path: ["rules", "propose"],
  summaryKey: "rules.command.propose",
  usage: "finitemonkey rules propose [--yes]",
  status: "ready",
  maxPositionals: 0,
  run: async (ctx) => {
    const root = projectRoot(ctx);
    const rules = effectiveRules(ctx.runtime, root);
    if (!rules.ok) return invalid(ctx, rules.error);
    const promoteAfter = policyNumber(ctx.runtime, root, ["rules", "promoteAfter"], DEFAULT_PROMOTE_AFTER);
    const proposals = buildProposals(
      projectInventory(ctx),
      rules.value,
      readViolations(ctx.runtime, fmDir(root)),
      promoteAfter,
    );
    const listed = proposals.flatMap((proposal) => proposalLines(ctx, proposal));
    const data = { schema: RULES_PROPOSE_SCHEMA, proposals, written: [] as readonly string[] };
    if (proposals.length === 0) return success(data, [ctx.t("rules.propose.none")]);
    if (!isPerson(ctx)) {
      if (ctx.yes)
        return failureFrom(
          ctx.t,
          needsPersonProblem("rules.propose.person_only", "finitemonkey rules propose (in a terminal)"),
          listed,
        );
      return success(data, [...listed, ctx.t("rules.propose.not_written")]);
    }
    const accepted = await ask(ctx, proposals);
    if (accepted.length === 0) return success(data, [ctx.t("rules.propose.nothing_accepted")]);
    const written = writeAccepted(ctx, root, accepted);
    if (!written.ok)
      return failureFrom(ctx.t, {
        code: "rules_write_failed",
        messageKey: "rules.error.write_failed",
        params: { detail: written.error },
        fix: `edit ${RULES_FILE}`,
        exitCode: ExitCode.Internal,
      });
    const ids = accepted.map((item) => item.id);
    return success({ ...data, written: ids }, [
      ctx.t("rules.propose.written", { count: ids.length, file: RULES_FILE }),
    ]);
  },
};

export const rulesViolationCommand: CommandSpec = {
  path: ["rules", "violation"],
  summaryKey: "rules.command.violation",
  usage: "finitemonkey rules violation <id> [--detail <text>]",
  status: "ready",
  maxPositionals: 1,
  options: { detail: { type: "string" } },
  run: (ctx, args) => {
    const root = projectRoot(ctx);
    const rules = effectiveRules(ctx.runtime, root);
    if (!rules.ok) return Promise.resolve(invalid(ctx, rules.error));
    const id = args.positionals[0] ?? "";
    if (!rules.value.some((rule) => rule.id === id))
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "rules.violation.unknown", "finitemonkey rules coverage", { id }),
        ),
      );
    const given = args.values["detail"];
    const detail = typeof given === "string" ? given : "";
    ctx.runtime.mkdir(fmDir(root));
    recordViolation(ctx.runtime, fmDir(root), {
      session: ctx.env["CLAUDE_SESSION_ID"] ?? "",
      rule: id,
      source: "person",
      detail,
    });
    const count = readViolations(ctx.runtime, fmDir(root)).filter((item) => item.rule === id).length;
    return Promise.resolve(
      success({ schema: "finitemonkey/rules-violation@1", rule: id, count }, [
        ctx.t("rules.violation.recorded", { id, count }),
      ]),
    );
  },
};
