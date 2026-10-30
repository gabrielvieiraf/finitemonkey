export const MOD_STATE_SCHEMA = "finitemonkey/mod-state@1";

export type RuleTarget = "path" | "command";
export type TightenMode = "off" | "shadow" | "active";

export interface ModRule {
  readonly id: string;
  readonly target: RuleTarget;
  readonly pattern: string;
  readonly reason: string;
}

export interface ModAttribution {
  readonly forbid: boolean;
  readonly trailer: string | null;
}

export interface ModState {
  readonly schema: typeof MOD_STATE_SCHEMA;
  readonly root: string;
  readonly mode: TightenMode;
  readonly band: TightenMode;
  readonly failReason: string;
  readonly rules: readonly ModRule[];
  readonly attribution: ModAttribution;
  readonly instructions: string;
}

export interface CompiledRule {
  readonly rule: ModRule;
  readonly regex: RegExp;
}

export interface LoadedState {
  readonly root: string;
  readonly mode: TightenMode;
  readonly band: TightenMode;
  readonly attribution?: ModAttribution;
  readonly instructions: string;
  readonly failReason?: string;
  readonly rules: readonly CompiledRule[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MODES: readonly TightenMode[] = ["off", "shadow", "active"];
const TARGETS: readonly RuleTarget[] = ["path", "command"];

const compile = (pattern: string): RegExp | undefined => {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
};

const ruleOf = (value: unknown): CompiledRule | undefined => {
  if (!isRecord(value)) return undefined;
  const { id, target, pattern, reason } = value;
  const known = TARGETS.find((item) => item === target);
  if (typeof id !== "string" || known === undefined || typeof pattern !== "string" || typeof reason !== "string")
    return undefined;
  const regex = compile(pattern);
  return regex === undefined ? undefined : { rule: { id, target: known, pattern, reason }, regex };
};

const attributionOf = (value: unknown): ModAttribution | undefined => {
  if (!isRecord(value) || typeof value["forbid"] !== "boolean") return undefined;
  const trailer = value["trailer"];
  return { forbid: value["forbid"], trailer: typeof trailer === "string" && trailer !== "" ? trailer : null };
};

const dataOf = (parsed: unknown): unknown => (isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed);

export const parseModState = (text: string): LoadedState | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const data = dataOf(parsed);
  if (!isRecord(data) || data["schema"] !== MOD_STATE_SCHEMA || typeof data["root"] !== "string") return undefined;
  const mode = MODES.find((item) => item === data["mode"]) ?? "shadow";
  const raw = Array.isArray(data["rules"]) ? data["rules"] : [];
  const rules = raw.map(ruleOf).filter((rule): rule is CompiledRule => rule !== undefined);
  const failReason = data["failReason"];
  const band = MODES.find((item) => item === data["band"]) ?? "active";
  const attribution = attributionOf(data["attribution"]);
  return {
    root: data["root"],
    mode,
    band,
    rules,
    instructions: typeof data["instructions"] === "string" ? data["instructions"] : "",
    ...(attribution === undefined ? {} : { attribution }),
    ...(typeof failReason === "string" ? { failReason } : {}),
  };
};
