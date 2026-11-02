import { nowMs } from "../core/clock.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { logEvent } from "../evidence/log.js";
import type { Note } from "../evidence/types.js";
import type { GateContext } from "../gate/types.js";
import { loadProjectConfig } from "../git/project-config.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { API_CONSISTENCY_FEATURE } from "./consistency.js";
import { liveConfig } from "./running-api.js";

const RUN_TIMEOUT_MS = 120_000;
const MIN_REMAINING_MS = 5_000;
const MAX_LISTED = 10;
const LIVE_KINDS = new Set(["live_error_shapes", "live_error_shape_mismatch", "live_pagination"]);

export interface LiveOutcome {
  readonly notes: readonly Note[];
  readonly blocking: boolean;
}

const NONE: LiveOutcome = { notes: [], blocking: false };

const note = (key: string, params: Note["params"] = {}): Note => ({ key, params });

const paramsOf = (item: Readonly<Record<string, unknown>>): Note["params"] =>
  Object.fromEntries(
    Object.entries(item).flatMap(([key, value]): [string, string | number][] =>
      typeof value === "string" || typeof value === "number" ? [[key, value]] : [],
    ),
  );

export const parseLive = (
  stdout: string,
): { readonly live: readonly Note[]; readonly contractProblems: number } | undefined => {
  const body = parseJsonObject(stdout.trim().split("\n").at(-1) ?? "");
  const data = body.ok ? body.value["data"] : undefined;
  if (!isRecord(data) || data["ran"] !== true || !Array.isArray(data["live"])) return undefined;
  const live = data["live"].flatMap((item: unknown): Note[] =>
    isRecord(item) && typeof item["kind"] === "string" && LIVE_KINDS.has(item["kind"])
      ? [note(`gate.contract.api.${item["kind"]}`, paramsOf(item))]
      : [],
  );
  const contractProblems = typeof data["contractProblems"] === "number" ? data["contractProblems"] : 0;
  return { live, contractProblems };
};

const notRun = (blocking: boolean): LiveOutcome => ({ notes: [note("gate.contract.live.not_run")], blocking });

export const liveOutcome = (ctx: GateContext): LiveOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, API_CONSISTENCY_FEATURE);
  if (mode === "off" || liveConfig(loadProjectConfig(ctx.runtime, ctx.paths.root)) === undefined) return NONE;
  const remaining = ctx.deadline - nowMs(ctx.runtime);
  if (!ctx.trusted || remaining < MIN_REMAINING_MS) return notRun(mode === "active");
  const run = ctx.runtime.execSelf(["contract", "run", "--json"], ctx.paths.root, Math.min(remaining, RUN_TIMEOUT_MS));
  const parsed = run.timedOut ? undefined : parseLive(run.stdout);
  if (parsed === undefined) return notRun(mode === "active");
  logEvent(ctx.runtime, ctx.paths, "contract.live", {
    task: ctx.contract.id,
    live: parsed.live.length,
    contract: parsed.contractProblems,
  });
  if (parsed.live.length === 0) return NONE;
  const notes = parsed.live.slice(0, MAX_LISTED);
  if (mode === "active") return { notes, blocking: true };
  recordFeatureShadow(ctx.runtime, ctx.paths, API_CONSISTENCY_FEATURE, {
    task: ctx.contract.id,
    live: parsed.live.length,
  });
  return { notes: [note("gate.contract.api_shadow", { count: parsed.live.length }), ...notes], blocking: false };
};
