import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import {
  HOSTS_FILE,
  hostsYaml,
  INFRA_FILE,
  INFRA_SCHEMA,
  infraYaml,
  type LevelRecord,
  preservedFields,
  readHosts,
  readLevel,
} from "../infra/file.js";
import { planFiles, type PlannedFile, writePlanned } from "../infra/plan-files.js";
import { remoteLines } from "../infra/remote.js";
import { scanInfra } from "../infra/scan.js";
import type { Inventory } from "../infra/types.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const INFRA_FEATURE = "infra";

const levelFor = (ctx: Ctx, root: AbsolutePath, inventory: Inventory): LevelRecord => {
  const recorded = readLevel(ctx.runtime, root);
  return recorded?.source === "confirmed" ? recorded : { level: inventory.level, source: "detected" };
};

const inventoryLines = (ctx: Ctx, inventory: Inventory, level: LevelRecord): readonly string[] => {
  const patterns = [...new Set(inventory.hits.map((hit) => hit.pattern))];
  return [
    ctx.t("infra.level", { level: level.level, source: level.source, detected: inventory.level }),
    ...(patterns.length === 0 ? [ctx.t("infra.none")] : []),
    ...patterns.map((id) =>
      ctx.t("infra.pattern", {
        id,
        files: inventory.hits
          .filter((hit) => hit.pattern === id)
          .map((hit) => `${hit.file}:${String(hit.line)}`)
          .join(", "),
      }),
    ),
    ...inventory.targets.map((target) =>
      ctx.t("infra.target", {
        type: target.type,
        trigger: target.trigger,
        build: target.buildLocation,
        artifact: target.artifact,
        migration: target.migration,
        health: target.health,
        rollback: target.rollback,
        ci: target.waitsForCi,
        hosts: target.hosts.length === 0 ? "-" : target.hosts.join(", "),
      }),
    ),
    ...inventory.risks.map((risk) =>
      ctx.t(`infra.risk.${risk.id}`, { at: `${risk.file}:${String(risk.line)}`, severity: risk.severity }),
    ),
    ...inventory.conflicts.map((list) => ctx.t("infra.conflict", { list })),
  ];
};

const hostsIgnored = (ctx: Ctx, root: AbsolutePath): boolean =>
  ctx.runtime.git(["check-ignore", "-q", HOSTS_FILE], root).ok;

interface WriteOutcome {
  readonly lines: readonly string[];
  readonly infra: string;
  readonly hosts: string;
}

const writeHosts = (ctx: Ctx, root: AbsolutePath, inventory: Inventory, active: boolean): readonly string[] => {
  if (inventory.hosts.length === 0) return [];
  if (!hostsIgnored(ctx, root)) return [ctx.t("infra.hosts_not_ignored", { file: HOSTS_FILE })];
  const [planned] = planFiles(ctx.runtime, root, [{ path: HOSTS_FILE, text: hostsYaml(inventory.hosts) }]);
  if (planned === undefined || planned.action === "unchanged" || !active) return [];
  const saved = writePlanned(ctx.runtime, root, [planned], true);
  return saved.written.length > 0
    ? [ctx.t("infra.hosts_written", { count: inventory.hosts.length, file: HOSTS_FILE })]
    : [];
};

const infraOutcome = (ctx: Ctx, root: AbsolutePath, planned: PlannedFile, active: boolean): readonly string[] => {
  if (planned.action === "unchanged") return [ctx.t("infra.unchanged", { file: INFRA_FILE })];
  const overwrite = ctx.yes;
  if (!active || (planned.action === "differs" && !overwrite))
    return [ctx.t(active ? "infra.pending" : "infra.not_written", { file: INFRA_FILE }), ...planned.diff];
  const saved = writePlanned(ctx.runtime, root, [planned], overwrite);
  return saved.written.length > 0
    ? [ctx.t("infra.written", { file: INFRA_FILE }), ...(planned.action === "differs" ? planned.diff : [])]
    : [ctx.t("infra.write_failed", { file: INFRA_FILE })];
};

const writeAll = (ctx: Ctx, root: AbsolutePath, inventory: Inventory, text: string, active: boolean): WriteOutcome => {
  const [planned] = planFiles(ctx.runtime, root, [{ path: INFRA_FILE, text }]);
  if (planned === undefined) return { lines: [], infra: "skipped", hosts: "skipped" };
  const lines = [...infraOutcome(ctx, root, planned, active), ...writeHosts(ctx, root, inventory, active)];
  const pending = planned.action === "differs" && !ctx.yes;
  return {
    lines,
    infra: !active ? "skipped" : pending ? "pending" : planned.action === "unchanged" ? "unchanged" : "written",
    hosts: inventory.hosts.length === 0 ? "none" : hostsIgnored(ctx, root) ? "local" : "refused",
  };
};

const data = (inventory: Inventory, level: LevelRecord, written: WriteOutcome): Readonly<Record<string, unknown>> => ({
  schema: INFRA_SCHEMA,
  level: level.level,
  levelSource: level.source,
  detectedLevel: inventory.level,
  patterns: inventory.hits,
  targets: inventory.targets,
  risks: inventory.risks,
  conflicts: inventory.conflicts,
  hosts: inventory.hosts.map((entry) => entry.alias),
  infraFile: written.infra,
  hostsFile: written.hosts,
});

const remoteRefused = (ctx: Ctx): CommandResult =>
  failureFrom(ctx.t, needsPersonProblem("infra.remote.needs_person", "finitemonkey infra --remote --yes"));

const runInfra = (ctx: Ctx, root: AbsolutePath, values: OptionValues): CommandResult => {
  const paths = fmPaths(root);
  const mode = featureMode(ctx.runtime, paths, INFRA_FEATURE);
  if (mode === "off") return success({ schema: INFRA_SCHEMA, mode }, [ctx.t("infra.off")]);
  const remote = values["remote"] === true;
  if (remote && !(ctx.yes && isPerson(ctx))) return remoteRefused(ctx);
  const inventory = scanInfra(ctx.runtime, root, readHosts(ctx.runtime, root));
  const level = levelFor(ctx, root, inventory);
  const active = mode === "active" && !ctx.dryRun;
  const written = writeAll(
    ctx,
    root,
    inventory,
    infraYaml(inventory, level, preservedFields(ctx.runtime, root)),
    active,
  );
  if (mode === "shadow") recordFeatureShadow(ctx.runtime, paths, INFRA_FEATURE, { risks: inventory.risks.length });
  const human = [
    ...inventoryLines(ctx, inventory, level),
    ...written.lines,
    ...(remote ? remoteLines(ctx, root, inventory.hosts) : []),
  ];
  const result = success(data(inventory, level, written), human);
  return written.infra === "pending" ? { ...result, next: "finitemonkey infra --yes" } : result;
};

export const infraCommand: CommandSpec = {
  path: ["infra"],
  summaryKey: "command.infra.summary",
  usage: "finitemonkey infra [--remote] [--dry-run] [--yes]",
  status: "ready",
  maxPositionals: 0,
  options: { remote: { type: "boolean" } },
  run: (ctx, args) => {
    const repo = repoOf(ctx);
    return Promise.resolve(
      repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : runInfra(ctx, repo.root, args.values),
    );
  },
};
