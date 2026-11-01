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
  readonly cost: { readonly usd: number; readonly requests: number } | null;
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
  } | null;
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

const costOf = (value: unknown): GateView["cost"] =>
  isRecord(value) && typeof value["usd"] === "number" && typeof value["requests"] === "number"
    ? { usd: value["usd"], requests: value["requests"] }
    : null;

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
      }
    : null;

export const trajectoryLine = (trajectory: NonNullable<GateView["trajectory"]>): string =>
  [
    `trajectory ${trajectory.domain}: ${trajectory.band ?? "no accepted work"}`,
    trajectory.ricochet === null
      ? "no ricochet"
      : `last ricochet ${trajectory.ricochet.concept} ${trajectory.ricochet.week.slice(-3)}`,
  ].join(", ");

export const knowledgeLine = (knowledge: NonNullable<GateView["knowledge"]>): string =>
  `knowledge: ${String(knowledge.stale)} stale · ${String(knowledge.contradictions)} rules contradict code · ${String(knowledge.quarantined)} in quarantine`;

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export const sparkline = (values: readonly number[]): string =>
  values
    .map((value) => SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.round(value * (SPARK.length - 1))))] ?? "")
    .join("");

export const blindLine = (blind: NonNullable<GateView["blindBand"]>): string =>
  `blind band ${blind.domain} ${blind.index.toFixed(2)} ${sparkline(blind.recent)} (${String(blind.withoutCriterion)}/${String(blind.helps)} help without criterion)`;

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
    cost: costOf(data["cost"]),
    xray: xrayOf(data["xray"]),
    blindBand: blindOf(data["blindBand"]),
    knowledge: knowledgeOf(data["knowledge"]),
    trajectory: trajectoryOf(data["trajectory"]),
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

export const bandLine = (view: GateView): string =>
  [
    ...(view.bypasses > 0 ? [`⚠ ${String(view.bypasses)} guard bypassed`] : []),
    `gate ${markOf(view.light)} ${String(view.passed)}/${String(view.total)}`,
    ...(view.notVerified.length > 0 ? [`${String(view.notVerified.length)} not verified`] : []),
    ...(view.contract === null ? [] : [`contract ${short(view.contract.hash)}`]),
    ...(view.editsSinceGate !== null && view.editsSinceGate > 0
      ? [`evidence ${String(view.editsSinceGate)} edits old`]
      : []),
    ...(view.knowledge === null ? [] : [knowledgeLine(view.knowledge)]),
    ...(view.blindBand === null || view.blindBand.withoutCriterion === 0 ? [] : [blindLine(view.blindBand)]),
    ...(view.trajectory === null ? [] : [trajectoryLine(view.trajectory)]),
    ...(view.loop === null ? [] : [`loop ${String(view.loop.count)}/${String(view.loop.limit)}`]),
    ...(view.cost === null ? [] : [`$${view.cost.usd.toFixed(2)} this contract`]),
    ...(view.xray === null || view.xray.beyond === 0
      ? []
      : [`x-ray ${String(view.xray.beyond)} beyond the record without criterion`]),
  ].join(" · ");

export const turnLine = (view: GateView): string =>
  [
    `gate ${markOf(view.light)}`,
    ...(view.notVerified.length > 0 ? [`${String(view.notVerified.length)} criteria without check`] : []),
    ...(view.contract === null ? [] : [`contract ${short(view.contract.hash)}`]),
  ].join(" · ");

export const checkLine = (check: ViewCheck): string =>
  `${check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "○"} ${check.id}${check.stale ? " (stale)" : ""}`;

export const notVerifiedLine = (item: ViewNotVerified): string => `○ ${item.id}: ${item.reason} → ${item.verify}`;

export const statusText = (view: GateView): string =>
  [
    `finitemonkey ${bandLine(view)}`,
    ...view.checks.map(checkLine),
    ...(view.notVerified.length > 0 ? ["not verified:", ...view.notVerified.map(notVerifiedLine)] : []),
  ].join("\n");
