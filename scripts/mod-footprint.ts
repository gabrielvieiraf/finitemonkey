export const FOOTPRINT_SCHEMA = "finitemonkey/mod-footprint@1";
export const MOD_MODULE = "./register.mjs";

export interface GatingHook {
  readonly hook: string;
  readonly hasCatch: boolean;
}

export interface ModFootprint {
  readonly schema: typeof FOOTPRINT_SCHEMA;
  readonly module: string;
  readonly reach: readonly string[];
  readonly gating: readonly GatingHook[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const hooksEntry = (report: unknown): Readonly<Record<string, unknown>> | undefined =>
  list(isRecord(report) ? report["contents"] : undefined)
    .filter(isRecord)
    .find((entry) => entry["type"] === "hooks");

const gatingOf = (entry: Readonly<Record<string, unknown>>): readonly GatingHook[] =>
  list(entry["gatingHooks"])
    .filter(isRecord)
    .filter((item) => item["module"] === MOD_MODULE)
    .flatMap((item) =>
      typeof item["hook"] === "string" && typeof item["hasCatch"] === "boolean"
        ? [{ hook: item["hook"], hasCatch: item["hasCatch"] }]
        : [],
    )
    .sort((a, b) => a.hook.localeCompare(b.hook));

const reachOf = (entry: Readonly<Record<string, unknown>>): readonly string[] =>
  list(entry["notes"])
    .filter((note): note is string => typeof note === "string")
    .filter((note) => note.startsWith(`${MOD_MODULE} `) && !note.includes(" gating hook "))
    .map((note) => note.slice(MOD_MODULE.length + 1))
    .sort();

export const footprintOf = (report: unknown): ModFootprint | undefined => {
  const entry = hooksEntry(report);
  if (entry === undefined) return undefined;
  return { schema: FOOTPRINT_SCHEMA, module: MOD_MODULE, reach: reachOf(entry), gating: gatingOf(entry) };
};

export const parseFootprint = (text: string): ModFootprint | undefined => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || parsed["schema"] !== FOOTPRINT_SCHEMA) return undefined;
    const reach = list(parsed["reach"]).filter((item): item is string => typeof item === "string");
    const gating = list(parsed["gating"])
      .filter(isRecord)
      .flatMap((item) =>
        typeof item["hook"] === "string" && typeof item["hasCatch"] === "boolean"
          ? [{ hook: item["hook"], hasCatch: item["hasCatch"] }]
          : [],
      );
    return { schema: FOOTPRINT_SCHEMA, module: MOD_MODULE, reach, gating };
  } catch {
    return undefined;
  }
};

const lines = (footprint: ModFootprint): readonly string[] => [
  ...footprint.reach,
  ...footprint.gating.map((item) => `gating ${item.hook}${item.hasCatch ? " with .catch" : " without .catch"}`),
];

export const footprintDiff = (committed: ModFootprint, fresh: ModFootprint): readonly string[] => {
  const before = new Set(lines(committed));
  const after = new Set(lines(fresh));
  return [
    ...[...after].filter((line) => !before.has(line)).map((line) => `+ ${line}`),
    ...[...before].filter((line) => !after.has(line)).map((line) => `- ${line}`),
  ];
};

export const footprintText = (footprint: ModFootprint): string => `${JSON.stringify(footprint, null, 2)}\n`;
