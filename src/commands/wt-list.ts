import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { toPosixPath } from "../core/posix-path.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import type { CleanupClass } from "../wt/classify.js";
import { wtDoctor, type WtFinding } from "../wt/doctor.js";
import type { OwnerKind, WorktreeStatus } from "../wt/entry.js";
import { classifyAll, type Inventory, loadInventory } from "../wt/inventory.js";
import { notRepository } from "./git-problems.js";
import type { OptionValues } from "./types.js";
import type { CommandSpec } from "./types.js";

export const WT_LIST_SCHEMA = "finitemonkey/wt-list@1";

export interface WtListRow {
  readonly id: string | null;
  readonly path: string;
  readonly class: CleanupClass;
  readonly branch: string | null;
  readonly owner: OwnerKind;
  readonly purpose: string;
  readonly port: number | null;
  readonly status: WorktreeStatus | null;
  readonly activityAt: string | null;
  readonly ageDays: number | null;
  readonly exclusiveBytes: number | null;
  readonly pr: number | null;
  readonly dirty: readonly string[];
}

export interface WtListData {
  readonly schema: typeof WT_LIST_SCHEMA;
  readonly worktrees: readonly WtListRow[];
}

const ageDays = (now: string, at: string | null): number | null => {
  if (at === null) return null;
  const age = (Date.parse(now) - Date.parse(at)) / 86_400_000;
  return Number.isFinite(age) ? Math.max(0, Math.floor(age)) : null;
};

export const staleDaysOption = (values: OptionValues): number | undefined => {
  const raw = stringOption(values, "stale-days");
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

export const inventoryOf = (ctx: Ctx, values: OptionValues): Inventory | undefined =>
  loadInventory(ctx.runtime, ctx.cwd, staleDaysOption(values));

const rowsOf = (ctx: Ctx, inventory: Inventory): readonly WtListRow[] =>
  classifyAll(inventory).map((item) => ({
    id: item.entry?.id ?? null,
    path: toPosixPath(item.path),
    class: item.cls,
    branch: item.branch,
    owner: item.entry?.owner.kind ?? "unknown",
    purpose: item.entry?.purpose ?? "",
    port: item.entry?.ports?.from ?? null,
    status: item.entry?.status ?? null,
    activityAt: item.activityAt,
    ageDays: ageDays(ctx.runtime.now(), item.entry?.createdAt ?? item.activityAt),
    exclusiveBytes: item.tree === undefined ? null : (ctx.runtime.exclusiveBytes(toAbsolutePath(item.path)) ?? null),
    pr: item.entry?.pr ?? null,
    dirty: item.dirty,
  }));

const sizeText = (bytes: number | null): string =>
  bytes === null
    ? "-"
    : bytes < 1_048_576
      ? `${String(Math.ceil(bytes / 1024))} KB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

export const wtListCommand: CommandSpec = {
  path: ["wt", "list"],
  summaryKey: "wt.command.list",
  usage: "finitemonkey wt list [--stale-days <n>] [--json]",
  status: "ready",
  options: { "stale-days": { type: "string" } },
  run: (ctx, args): Promise<CommandResult> => {
    const inventory = inventoryOf(ctx, args.values);
    if (inventory === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const rows = rowsOf(ctx, inventory);
    const data: WtListData = { schema: WT_LIST_SCHEMA, worktrees: rows };
    const human = [
      ctx.t("wt.list.title", { count: rows.length }),
      ...rows.map((row) =>
        ctx.t("wt.list.row", {
          id: row.id ?? "-",
          cls: row.class,
          branch: row.branch ?? "-",
          owner: row.owner,
          port: row.port === null ? "-" : String(row.port),
          age: row.ageDays === null ? "-" : String(row.ageDays),
          size: sizeText(row.exclusiveBytes),
          purpose: row.purpose === "" ? "-" : row.purpose,
        }),
      ),
    ];
    return Promise.resolve(success(data, human));
  },
};

const findingLine = (ctx: Ctx, item: WtFinding): string =>
  ctx.t(`wt.doctor.${item.kind}`, { path: item.path, detail: item.detail });

export const wtDoctorCommand: CommandSpec = {
  path: ["wt", "doctor"],
  summaryKey: "wt.command.doctor",
  usage: "finitemonkey wt doctor [--stale-days <n>] [--json]",
  status: "ready",
  options: { "stale-days": { type: "string" } },
  run: (ctx, args): Promise<CommandResult> => {
    const inventory = inventoryOf(ctx, args.values);
    if (inventory === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const findings = wtDoctor(inventory, ctx.env);
    const data = { schema: "finitemonkey/wt-doctor@1", findings };
    const human = [
      ctx.t("wt.doctor.title", { count: findings.length }),
      ...findings.map((item) => findingLine(ctx, item)),
    ];
    if (findings.length === 0) return Promise.resolve(success(data, human));
    return Promise.resolve({
      ok: false,
      exitCode: ExitCode.CheckFailed,
      error: {
        code: "doctor_failed",
        message: ctx.t("wt.doctor.title", { count: findings.length }),
        fix: "finitemonkey wt clean",
      },
      data,
      human,
    });
  },
};
