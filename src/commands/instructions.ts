import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { success } from "../core/result.js";
import { type InstructionFinding, instructionFindings } from "../instructions/findings.js";
import { readLoadRecords } from "../instructions/log.js";
import { instructionsMeasure, loadDiff } from "../instructions/report.js";
import { resolveInstructions } from "../instructions/resolve.js";
import { type Inventory, listedFile } from "../instructions/types.js";
import { projectRoot } from "../secrets/project.js";
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

export const instructionsCommand: CommandSpec = {
  path: ["instructions"],
  summaryKey: "instructions.command.summary",
  usage: "finitemonkey instructions [--session <id>]",
  status: "ready",
  maxPositionals: 0,
  options: { session: { type: "string" } },
  run: (ctx, args) => {
    const inventory = projectInventory(ctx);
    const findings = instructionFindings(inventory);
    const records = readLoadRecords(ctx.runtime, toAbsolutePath(join(projectRoot(ctx), FM_DIR)));
    const asked = args.values["session"];
    const diff = loadDiff(inventory, records, ctx.platform, typeof asked === "string" ? asked : undefined);
    const measure = instructionsMeasure(inventory, findings, records, ctx.platform);
    const files = inventory.files.map(listedFile);
    const data = { schema: INSTRUCTIONS_SCHEMA, files, shadowed: inventory.shadowed, findings, diff, measure };
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
      ctx.t("instructions.measure", { ...measure }),
    ];
    return Promise.resolve(success(data, human));
  },
};
