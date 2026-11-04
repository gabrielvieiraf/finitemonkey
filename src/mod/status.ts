import { count, label } from "./labels.js";

export interface ViewCheck {
  readonly id: string;
  readonly status: string;
  readonly stale: boolean;
  readonly verify: string;
}

export interface ViewNotVerified {
  readonly id: string;
  readonly reason: string;
  readonly verify: string;
}

export interface GateView {
  readonly task: string | null;
  readonly contract: { readonly id: string; readonly hash: string } | null;
  readonly light: string;
  readonly passed: number;
  readonly total: number;
  readonly checks: readonly ViewCheck[];
  readonly notVerified: readonly ViewNotVerified[];
  readonly editsSinceGate: number | null;
  readonly bypasses: number;
  readonly loop: { readonly count: number; readonly limit: number } | null;
  readonly cost: {
    readonly usd: number;
    readonly requests: number;
    readonly tokens: number;
    readonly billing: "api" | "subscription";
  } | null;
  readonly xray: { readonly beyond: number; readonly blocks: number } | null;
  readonly knowledge: { readonly stale: number; readonly contradictions: number; readonly quarantined: number } | null;
  readonly blindBand: {
    readonly domain: string;
    readonly index: number;
    readonly withoutCriterion: number;
    readonly helps: number;
    readonly recent: readonly number[];
  } | null;
  readonly trajectory: {
    readonly domain: string;
    readonly band: string | null;
    readonly ricochet: { readonly concept: string; readonly week: string } | null;
    readonly recent?: readonly number[];
  } | null;
  readonly triage: { readonly flagged: number; readonly open: number } | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (record: Readonly<Record<string, unknown>>, key: string): string =>
  typeof record[key] === "string" ? record[key] : "";

const list = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const contractOf = (value: unknown): GateView["contract"] =>
  isRecord(value) && typeof value["id"] === "string" && typeof value["hash"] === "string"
    ? { id: value["id"], hash: value["hash"] }
    : null;

const loopOf = (value: unknown): GateView["loop"] =>
  isRecord(value) && typeof value["count"] === "number" && typeof value["limit"] === "number"
    ? { count: value["count"], limit: value["limit"] }
    : null;

const costOf = (data: Readonly<Record<string, unknown>>): GateView["cost"] => {
  const value = data["cost"];
  const tokens = data["costTokens"];
  return isRecord(value) && typeof value["usd"] === "number" && typeof value["requests"] === "number"
    ? {
        usd: value["usd"],
        requests: value["requests"],
        tokens: typeof tokens === "number" ? tokens : 0,
        billing: data["billing"] === "subscription" ? "subscription" : "api",
      }
    : null;
};

const xrayOf = (value: unknown): GateView["xray"] =>
  isRecord(value) && typeof value["beyondWithoutCriterion"] === "number" && typeof value["blocks"] === "number"
    ? { beyond: value["beyondWithoutCriterion"], blocks: value["blocks"] }
    : null;

const numbers = (value: unknown): readonly number[] =>
  Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];

const blindOf = (value: unknown): GateView["blindBand"] =>
  isRecord(value) &&
  typeof value["domain"] === "string" &&
  typeof value["index"] === "number" &&
  typeof value["withoutCriterion"] === "number" &&
  typeof value["helps"] === "number"
    ? {
        domain: value["domain"],
        index: value["index"],
        withoutCriterion: value["withoutCriterion"],
        helps: value["helps"],
        recent: numbers(value["recent"]),
      }
    : null;

const knowledgeOf = (value: unknown): GateView["knowledge"] =>
  isRecord(value) &&
  typeof value["stale"] === "number" &&
  typeof value["contradictions"] === "number" &&
  typeof value["quarantined"] === "number" &&
  value["stale"] + value["contradictions"] + value["quarantined"] > 0
    ? { stale: value["stale"], contradictions: value["contradictions"], quarantined: value["quarantined"] }
    : null;

const ricochetOf = (value: unknown): NonNullable<GateView["trajectory"]>["ricochet"] =>
  isRecord(value) && typeof value["concept"] === "string" && typeof value["week"] === "string"
    ? { concept: value["concept"], week: value["week"] }
    : null;

const trajectoryOf = (value: unknown): GateView["trajectory"] =>
  isRecord(value) && typeof value["domain"] === "string"
    ? {
        domain: value["domain"],
        band: typeof value["band"] === "string" ? value["band"] : null,
        ricochet: ricochetOf(value["ricochet"]),
        recent: numbers(value["recent"]),
      }
    : null;

const triageOf = (value: unknown): GateView["triage"] =>
  isRecord(value) && typeof value["flagged"] === "number" && typeof value["open"] === "number"
    ? { flagged: value["flagged"], open: value["open"] }
    : null;

export const triageLine = (triage: NonNullable<GateView["triage"]>): string =>
  label("mod.view.triage", { open: triage.open, flagged: triage.flagged });

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export const sparkline = (values: readonly number[]): string =>
  values
    .map((value) => SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.round(value * (SPARK.length - 1))))] ?? "")
    .join("");

const trajectorySpark = (recent: readonly number[] | undefined): string =>
  recent === undefined || recent.length < 2 ? "" : ` ${sparkline(recent)}`;

export const trajectoryLine = (trajectory: NonNullable<GateView["trajectory"]>): string =>
  [
    label("mod.view.trajectory", {
      domain: trajectory.domain,
      spark: trajectorySpark(trajectory.recent),
      band: trajectory.band ?? label("mod.view.no_accepted_work"),
    }),
    trajectory.ricochet === null
      ? label("mod.view.no_ricochet")
      : label("mod.view.last_ricochet", {
          concept: trajectory.ricochet.concept,
          week: trajectory.ricochet.week.slice(-3),
        }),
  ].join(", ");

export const knowledgeLine = (knowledge: NonNullable<GateView["knowledge"]>): string =>
  [
    ...(knowledge.contradictions > 0 ? [label("mod.view.knowledge_rules", { count: knowledge.contradictions })] : []),
    ...(knowledge.stale > 0 ? [label("mod.view.knowledge_stale", { count: knowledge.stale })] : []),
    ...(knowledge.quarantined > 0 ? [label("mod.view.knowledge_quarantined", { count: knowledge.quarantined })] : []),
  ].join(" · ");

export const loopLine = (loop: NonNullable<GateView["loop"]>): string =>
  loop.count + 1 >= loop.limit
    ? label("mod.view.loop_held", { count: loop.count })
    : label("mod.view.loop", { count: loop.count, limit: loop.limit });

export const blindLine = (blind: NonNullable<GateView["blindBand"]>): string =>
  label("mod.view.blind", {
    domain: blind.domain,
    index: blind.index.toFixed(2),
    spark: sparkline(blind.recent),
    without: blind.withoutCriterion,
    helps: blind.helps,
  });

export const parseStatus = (text: string): GateView | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["schema"] !== "finitemonkey/status@1") return undefined;
  const checks = list(data["checks"]).map((item) => ({
    id: str(item, "id"),
    status: str(item, "status"),
    stale: item["stale"] === true,
    verify: str(item, "verify"),
  }));
  const gate = isRecord(data["gate"]) ? data["gate"] : {};
  const edits = data["editsSinceGate"];
  return {
    task: typeof data["task"] === "string" ? data["task"] : null,
    contract: contractOf(data["contract"]),
    light: str(gate, "light") || "none",
    passed: checks.filter((check) => check.status === "passed").length,
    total: checks.length,
    checks,
    notVerified: list(data["notVerified"]).map((item) => ({
      id: str(item, "id"),
      reason: str(item, "reason"),
      verify: str(item, "verify"),
    })),
    editsSinceGate: typeof edits === "number" ? edits : null,
    bypasses: typeof data["bypasses"] === "number" ? data["bypasses"] : 0,
    loop: loopOf(data["loop"]),
    cost: costOf(data),
    xray: xrayOf(data["xray"]),
    blindBand: blindOf(data["blindBand"]),
    knowledge: knowledgeOf(data["knowledge"]),
    trajectory: trajectoryOf(data["trajectory"]),
    triage: triageOf(data["triage"]),
  };
};

const MARK: Readonly<Record<string, string>> = {
  green: "✓",
  red: "✗",
  incomplete: "…",
  did_not_run: "?",
  none: "·",
};

export const markOf = (light: string): string => MARK[light] ?? "·";

const short = (hash: string): string => hash.slice(0, 4);

export const costBand = (cost: NonNullable<GateView["cost"]>): string =>
  cost.billing === "subscription"
    ? label("mod.view.cost_tokens", { tokens: count(cost.tokens) })
    : label("mod.view.cost_usd", { usd: `$${cost.usd.toFixed(2)}` });

export const bandLine = (view: GateView): string =>
  [
    ...(view.bypasses > 0 ? [label("mod.view.bypassed", { count: view.bypasses })] : []),
    label("mod.view.gate", { mark: markOf(view.light), passed: view.passed, total: view.total }),
    ...(view.notVerified.length > 0 ? [label("mod.view.not_verified_count", { count: view.notVerified.length })] : []),
    ...(view.contract === null ? [] : [label("mod.view.contract_short", { hash: short(view.contract.hash) })]),
    ...(view.editsSinceGate !== null && view.editsSinceGate > 0
      ? [label("mod.view.evidence_old", { count: view.editsSinceGate })]
      : []),
    ...(view.knowledge === null ? [] : [knowledgeLine(view.knowledge)]),
    ...(view.blindBand === null || view.blindBand.withoutCriterion === 0 ? [] : [blindLine(view.blindBand)]),
    ...(view.trajectory === null ? [] : [trajectoryLine(view.trajectory)]),
    ...(view.triage === null || view.triage.open === 0 ? [] : [triageLine(view.triage)]),
    ...(view.loop === null ? [] : [loopLine(view.loop)]),
    ...(view.cost === null ? [] : [costBand(view.cost)]),
    ...(view.xray === null || view.xray.beyond === 0 ? [] : [label("mod.view.xray", { count: view.xray.beyond })]),
  ].join(" · ");

export const turnLine = (view: GateView): string =>
  [
    label("mod.view.gate_mark", { mark: markOf(view.light) }),
    ...(view.notVerified.length > 0
      ? [label("mod.view.criteria_without_check", { count: view.notVerified.length })]
      : []),
    ...(view.contract === null ? [] : [label("mod.view.contract_short", { hash: short(view.contract.hash) })]),
  ].join(" · ");

export const checkLine = (check: ViewCheck): string =>
  `${check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "○"} ${check.id}${check.stale ? ` ${label("mod.view.stale")}` : ""}`;

export const notVerifiedLine = (item: ViewNotVerified): string => `○ ${item.id}: ${item.reason} → ${item.verify}`;

export const statusText = (view: GateView): string =>
  [
    `finitemonkey ${bandLine(view)}`,
    ...view.checks.map(checkLine),
    ...(view.notVerified.length > 0
      ? [label("mod.view.not_verified_title"), ...view.notVerified.map(notVerifiedLine)]
      : []),
  ].join("\n");
