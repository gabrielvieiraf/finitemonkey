import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import {
  DEFAULT_VIOLATION_LIMIT,
  type DriftAt,
  type DriftFinding,
  gitDriftInput,
  INSTRUCTION_DRIFT_FEATURE,
  instructionDrift,
} from "../instructions/drift.js";
import { type InstructionFinding, instructionFindings } from "../instructions/findings.js";
import { readLoadRecords } from "../instructions/log.js";
import { instructionsMeasure, loadDiff } from "../instructions/report.js";
import { resolveInstructions } from "../instructions/resolve.js";
import { type Inventory, listedFile } from "../instructions/types.js";
import { featureMode } from "../policy/feature.js";
import { policyNumber } from "../policy/numbers.js";
import { projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { FM_DIR } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const INSTRUCTIONS_SCHEMA = "finitemonkey/instructions@1";

export const projectInventory = (ctx: Pick<Ctx, "cwd" | "runtime" | "platform">): Inventory =>
  resolveInstructions({
    runtime: ctx.runtime,
    root: projectRoot(ctx),
    cwd: ctx.cwd,
    home: ctx.runtime.homeDir(),
    platform: ctx.platform,
  });

export const findingLine = (ctx: Pick<Ctx, "t">, finding: InstructionFinding): string => {
  switch (finding.kind) {
    case "oversized":
      return ctx.t("instructions.finding.oversized", { file: finding.file, lines: finding.lines, max: finding.max });
    case "duplicate":
    case "conflict":
      return ctx.t(`instructions.finding.${finding.kind}`, {
        first: `${finding.first.file}:${String(finding.first.line)}`,
        second: `${finding.second.file}:${String(finding.second.line)}`,
        text: finding.first.text.slice(0, 80),
      });
    case "volatile":
      return ctx.t("instructions.finding.volatile", {
        at: `${finding.at.file}:${String(finding.at.line)}`,
        reason: finding.reason,
      });
    case "shadowed":
      return ctx.t("instructions.finding.shadowed", { file: finding.file, by: finding.by });
  }
};

const place = (at: DriftAt): string => `${at.file}:${String(at.line)}`;

export const driftLine = (ctx: Pick<Ctx, "t">, finding: DriftFinding): string => {
  const commit = finding.at.commit?.slice(0, 7) ?? ctx.t("instructions.drift.uncommitted");
  switch (finding.kind) {
    case "contradiction":
      return ctx.t(
        finding.proposal ? "instructions.drift.contradiction_proposal" : "instructions.drift.contradiction",
        {
          at: place(finding.at),
          other: place(finding.other),
          commit,
        },
      );
    case "wrong_manager":
      return ctx.t("instructions.drift.wrong_manager", {
        at: place(finding.at),
        ref: finding.ref,
        lockfile: finding.lockfile,
        commit,
      });
    case "violated_rule":
      return ctx.t("instructions.drift.violated_rule", {
        at: place(finding.at),
        ref: finding.ref,
        count: finding.count,
        commit,
      });
    case "forbidden_dependency":
    case "missing_path":
    case "missing_script":
    case "missing_symbol":
      return ctx.t(`instructions.drift.${finding.kind}`, { at: place(finding.at), ref: finding.ref, commit });
  }
};

export const projectDrift = (
  ctx: Pick<Ctx, "cwd" | "runtime">,
  findings: readonly InstructionFinding[],
): readonly DriftFinding[] => {
  const root = projectRoot(ctx);
  if (featureMode(ctx.runtime, fmPaths(root), INSTRUCTION_DRIFT_FEATURE) === "off") return [];
  const conflicts = findings.flatMap((finding) =>
    finding.kind === "conflict"
      ? [
          {
            first: { file: finding.first.file, line: finding.first.line },
            second: { file: finding.second.file, line: finding.second.line },
          },
        ]
      : [],
  );
  const violationLimit = policyNumber(ctx.runtime, root, ["knowledge", "violationLimit"], DEFAULT_VIOLATION_LIMIT);
  return instructionDrift(gitDriftInput(ctx.runtime, root, { conflicts, violationLimit }));
};

const strictFailure = <TData>(
  ctx: Pick<Ctx, "t">,
  strict: boolean,
  drift: readonly DriftFinding[],
  data: TData,
  human: readonly string[],
): CommandResult<TData> | undefined => {
  const firm = drift.filter((finding) => finding.kind !== "contradiction" || !finding.proposal);
  if (!strict || firm.length === 0) return undefined;
  return failureFrom(
    ctx.t,
    {
      code: "instructions_drift",
      messageKey: "instructions.drift.strict",
      params: { count: firm.length },
      fix: "finitemonkey instructions",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    human,
  );
};

export const instructionsCommand: CommandSpec = {
  path: ["instructions"],
  summaryKey: "instructions.command.summary",
  usage: "finitemonkey instructions [--session <id>] [--strict]",
  status: "ready",
  maxPositionals: 0,
  options: { session: { type: "string" }, strict: { type: "boolean" } },
  run: (ctx, args) => {
    const inventory = projectInventory(ctx);
    const findings = instructionFindings(inventory);
    const records = readLoadRecords(ctx.runtime, toAbsolutePath(join(projectRoot(ctx), FM_DIR)));
    const asked = args.values["session"];
    const diff = loadDiff(inventory, records, ctx.platform, typeof asked === "string" ? asked : undefined);
    const measure = instructionsMeasure(inventory, findings, records, ctx.platform);
    const files = inventory.files.map(listedFile);
    const drift = projectDrift(ctx, findings);
    const data = { schema: INSTRUCTIONS_SCHEMA, files, shadowed: inventory.shadowed, findings, diff, measure, drift };
    const human = [
      ctx.t("instructions.title", { count: files.length }),
      ...files.map((file) =>
        ctx.t(file.survivesCompaction ? "instructions.row.lasting" : "instructions.row.volatile", {
          layer: file.layer,
          reason: file.reason,
          lines: file.lines,
          tokens: file.tokens,
          file: file.display,
        }),
      ),
      diff.session === undefined
        ? ctx.t("instructions.diff.none")
        : ctx.t("instructions.diff.session", {
            session: diff.session,
            missing: diff.missing.length === 0 ? "-" : diff.missing.join(", "),
            unexpected: diff.unexpected.length === 0 ? "-" : diff.unexpected.join(", "),
          }),
      ...findings.map((finding) => `- ${findingLine(ctx, finding)}`),
      ...drift.map((finding) => `- ${driftLine(ctx, finding)}`),
      ctx.t("instructions.measure", { ...measure }),
    ];
    const strict = strictFailure(ctx, args.values["strict"] === true, drift, data, human);
    if (strict !== undefined) return Promise.resolve(strict);
    return Promise.resolve(success(data, human));
  },
};
