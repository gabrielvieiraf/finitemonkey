import { join } from "node:path";

import { stringOption } from "../core/args.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { envInHistory } from "../creds/history.js";
import { credentialInventory } from "../creds/inventory.js";
import { gitAt } from "../gate/git.js";
import { discoverCommands } from "../onboard/discover.js";
import { activeRisks, infraFiles, type Risk } from "../onboard/risks.js";
import { DEFAULT_COMMAND_TIMEOUT_S, type Ran, runCandidates } from "../onboard/run.js";
import {
  agentsBlock,
  ONBOARD_FEATURE,
  ONBOARD_FILE,
  ONBOARD_SCHEMA,
  type OnboardState,
  onboardText,
  outsideOnboardBlock,
  parseOnboard,
  passedCommands,
  withOnboardBlock,
  writeIfChanged,
} from "../onboard/state.js";
import { featureMode } from "../policy/feature.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import { scanHistory } from "../secrets/scan.js";
import type { ProjectFiles } from "../task/implicit.js";
import { fmPaths } from "../task/paths.js";
import { trustImplicit } from "../task/trust.js";
import { adoptable } from "../wt/adopt.js";
import { gitWorktrees } from "../wt/git-list.js";
import { commonDirOf, readRegistry } from "../wt/store.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey onboard [--timeout <seconds>]";
const LOCKS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"] as const;

const diskFiles = (ctx: Ctx, root: AbsolutePath): ProjectFiles => ({
  read: (relative) => {
    const text = ctx.runtime.readText(toAbsolutePath(join(root, relative)));
    return text.ok ? text.value : undefined;
  },
  exists: (relative) => ctx.runtime.stat(toAbsolutePath(join(root, relative))) !== undefined,
});

const historyCount = async (ctx: Ctx, root: AbsolutePath, previous: OnboardState | undefined) => {
  if (previous?.historyFindings !== undefined) return previous.historyFindings;
  const scanned = await scanHistory(ctx.runtime, root);
  return scanned.ok ? scanned.value.length : undefined;
};

const unregisteredWorktrees = (ctx: Ctx, root: AbsolutePath): readonly string[] => {
  const common = commonDirOf(ctx.runtime, root);
  const trees = gitWorktrees(ctx.runtime, root) ?? [];
  const registry = common === undefined ? undefined : readRegistry(ctx.runtime, common);
  return registry?.ok === true ? adoptable(registry.value, trees).map((tree) => tree.path) : [];
};

const commandLines = (ctx: Ctx, ran: readonly Ran[]): readonly string[] =>
  ran.map((item) => ctx.t(`onboard.ran.${item.outcome}`, { run: item.run, purpose: item.purpose }));

const riskLines = (ctx: Ctx, risks: readonly Risk[]): readonly string[] =>
  risks.length === 0
    ? [ctx.t("onboard.risks.none")]
    : [
        ctx.t("onboard.risks.title"),
        ...risks.map((risk) => `- ${ctx.t(`onboard.risk.${risk.kind}`, { subject: risk.subject })}`),
      ];

const onboard = async (ctx: Ctx, timeoutS: number): Promise<CommandResult> => {
  const root = projectRoot(ctx);
  if (featureMode(ctx.runtime, fmPaths(root), ONBOARD_FEATURE) === "off")
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "onboard.off", USAGE));
  const files = diskFiles(ctx, root);
  const ran = runCandidates(ctx.runtime, root, discoverCommands(files, outsideOnboardBlock), timeoutS);
  const previous = parseOnboard(files.read(ONBOARD_FILE));
  const state: OnboardState = {
    commands: passedCommands(ran),
    historyFindings: await historyCount(ctx, root, previous),
  };
  writeIfChanged(ctx.runtime, root, ONBOARD_FILE, onboardText(state));
  const body =
    state.commands.length === 0
      ? [`## ${ctx.t("onboard.block.heading")}`, "", ctx.t("onboard.block.none")]
      : agentsBlock(ctx.t("onboard.block.heading"), ctx.t("onboard.block.header"), state.commands);
  writeIfChanged(ctx.runtime, root, "AGENTS.md", withOnboardBlock(files.read("AGENTS.md"), body));
  if (isPerson(ctx)) trustImplicit(ctx.runtime, root, files);
  const tracked = (gitAt(ctx.runtime, root).out(["ls-files", "-z"]) ?? "").split("\0").filter((file) => file !== "");
  const credentials = credentialInventory(ctx.runtime, root);
  const unregistered = unregisteredWorktrees(ctx, root);
  const infra = infraFiles(tracked);
  const risks = activeRisks({
    ran,
    historyFindings: state.historyFindings,
    envHistory: envInHistory(ctx.runtime, root),
    credentials,
    unregistered,
    lockfileMissing: files.exists("package.json") && !LOCKS.some(files.exists),
  });
  return success(
    { schema: ONBOARD_SCHEMA, commands: ran, credentials: credentials.length, infra, worktrees: unregistered, risks },
    [
      ...commandLines(ctx, ran),
      ctx.t("onboard.inventory", {
        credentials: credentials.length,
        infra: infra.length,
        worktrees: unregistered.length,
      }),
      ...riskLines(ctx, risks),
    ],
  );
};

export const onboardCommand: CommandSpec = {
  path: ["onboard"],
  summaryKey: "command.onboard.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { timeout: { type: "string" } },
  run: (ctx, args) => {
    const raw = Number.parseInt(stringOption(args.values, "timeout") ?? "", 10);
    return onboard(ctx, Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_COMMAND_TIMEOUT_S);
  },
};
