import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { brokenHooks } from "../doctor/probe.js";
import { readFronts } from "../fronts/state.js";
import { statusSegment } from "../fronts/status.js";
import { unreviewedBypasses } from "../guards/bypass/ledger.js";
import { readAll, withDeadline } from "../hooks/stdin.js";
import { LOCK_FILE } from "../install/layout.js";
import { parseLock } from "../install/lock-file.js";
import { findGitRoot } from "../install/project.js";
import { readCachedBar } from "../planta/store.js";
import { budgetStatus } from "../spend/status.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { gateLight } from "./gate-state.js";
import { parseStatusInput, type StatusInput } from "./input.js";
import { composeLine, type Segment, segmentText } from "./render.js";
import { runWrapped } from "./wrap.js";

export const STDIN_MS = 300;
export const WRAP_MS = 700;
export const CEILING_MS = 1500;

const wrapOf = (ctx: Ctx, root: AbsolutePath): string | undefined => {
  const text = ctx.runtime.readText(toAbsolutePath(`${root}/${LOCK_FILE}`));
  const lock = text.ok ? parseLock(text.value) : undefined;
  if (!lock?.ok) return undefined;
  return (
    lock.value.entries.find((entry) => entry.added?.statusLine !== undefined)?.added?.statusLine?.wrap ?? undefined
  );
};

const columnsOf = (ctx: Ctx): number | undefined => {
  const columns = Number.parseInt(ctx.env["COLUMNS"] ?? "", 10);
  return Number.isInteger(columns) && columns > 0 ? columns : undefined;
};

const spendSegment = (ctx: Ctx, paths: FmPaths | undefined, input: StatusInput): { spend?: string } => {
  if (input.rateLimits.length > 0)
    return {
      spend: input.rateLimits
        .map((window) => ctx.t("statusline.rate", { name: window.name, percent: window.percent }))
        .join(" "),
    };
  if (paths === undefined) return {};
  const status = budgetStatus({
    runtime: ctx.runtime,
    paths,
    env: ctx.env,
    sessionId: input.sessionId,
    refresh: false,
  });
  const ratios = status.spends.flatMap((item) => (item.limit === undefined ? [] : [item.spent / item.limit]));
  if (status.level === "ok" || ratios.length === 0) return {};
  return { spend: ctx.t("statusline.budget", { percent: Math.round(Math.max(...ratios) * 100) }) };
};

const frontsSegment = (ctx: Ctx, root: AbsolutePath): string | undefined => {
  const state = readFronts(ctx.runtime, root);
  return state.ok ? statusSegment(state.value) : undefined;
};

const blueprintOf = (ctx: Ctx, paths: ReturnType<typeof fmPaths> | undefined): Segment["blueprint"] => {
  const bar = paths === undefined ? undefined : readCachedBar(ctx.runtime, paths);
  return bar === undefined ? undefined : { type: bar.type, green: bar.green, total: bar.total };
};

const lineFor = async (ctx: Ctx, input: StatusInput): Promise<string> => {
  const start = input.dir === undefined ? ctx.cwd : toAbsolutePath(input.dir, ctx.cwd);
  const root = findGitRoot(start, ctx.runtime);
  const paths = root === undefined ? undefined : fmPaths(root);
  const wrap = root === undefined ? undefined : wrapOf(ctx, root);
  const wrapped =
    wrap === undefined || root === undefined
      ? ""
      : await runWrapped(ctx.runtime, paths, {
          command: wrap,
          input: input.raw,
          cwd: root,
          timeoutMs: WRAP_MS,
          session: input.sessionId ?? "none",
        });
  const segment = segmentText(ctx.t, {
    task: paths === undefined ? undefined : readState(ctx.runtime, paths).active,
    gate: paths === undefined ? "none" : gateLight(ctx.runtime, paths),
    contextPercent: input.contextPercent,
    ...spendSegment(ctx, paths, input),
    fronts: root === undefined ? undefined : frontsSegment(ctx, root),
    blueprint: blueprintOf(ctx, paths),
    bypassed: paths === undefined ? 0 : unreviewedBypasses(ctx.runtime, paths).length,
    hooksBroken: paths !== undefined && input.version !== undefined && brokenHooks(ctx.runtime, paths, input.version),
  });
  return composeLine(wrapped, segment, columnsOf(ctx));
};

export const renderStatusLine = async (ctx: Ctx): Promise<string> => {
  try {
    const raw = await withDeadline(readAll(ctx.io.stdin), STDIN_MS, ctx.runtime.startTimer).catch(() => "");
    return await lineFor(ctx, parseStatusInput(raw));
  } catch {
    return "fm";
  }
};
