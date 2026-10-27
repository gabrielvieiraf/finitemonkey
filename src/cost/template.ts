import type { Translate } from "../i18n/translate.js";

const SCRIPT = String.raw`import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const STEM = SELF.replace(/\.mjs$/, "");
const TEXT = __TEXT__;
const DATE = "__DATE__";

const inputs = [
  { id: "fx_usd_brl", base: 5.4, unit: "BRL per USD", type: "FACT", source: "https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes", date: DATE },
  { id: "tax_on_foreign_services", base: 0.0638, unit: "ratio", type: "FACT", source: "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/iof", date: DATE },
  { id: "price_per_call_usd", base: 0.002, conservative: 0.003, unit: "USD per call", type: "FACT", source: "https://replace-with-the-provider-pricing-page", date: DATE },
  { id: "calls_per_operation", base: 3, conservative: 5, unit: "calls", type: "ASSUMPTION", source: "", date: DATE },
  { id: "operations_per_month", base: 10000, conservative: 25000, unit: "operations per month", type: "ASSUMPTION", source: "", date: DATE },
  { id: "platform_fixed_brl", base: 300, unit: "BRL per month", type: "FACT", source: "https://replace-with-the-hosting-pricing-page", date: DATE },
  { id: "price_per_operation_brl", base: 0.5, unit: "BRL per operation", type: "OPINION", source: "", date: DATE },
];

const computed = [
  { id: "unit_cost_brl", unit: "BRL per operation", readable: "price_per_call_usd * calls_per_operation * fx_usd_brl * (1 + tax_on_foreign_services)" },
  { id: "variable_cost_brl", unit: "BRL per month", readable: "unit_cost_brl * operations_per_month" },
  { id: "total_cost_brl", unit: "BRL per month", readable: "variable_cost_brl + platform_fixed_brl" },
  { id: "break_even_operations", unit: "operations per month", readable: "platform_fixed_brl / (price_per_operation_brl - unit_cost_brl)" },
];

const limits = [
  { provider: "provider", limit: "request size", value: 10, unit: "MB", accepted: 10, next_layer: "reverse proxy body limit", next_value: 10, source: "https://replace-with-the-provider-limits-page", date: DATE },
];

const measure = ["calls_per_operation", "operations_per_month", "unit_cost_brl"];

const KEYS = { unit: "unit_cost_brl", fixed: "platform_fixed_brl", breakEven: "break_even_operations" };
const SCENARIOS = { base: "F", conservative: "G" };
const SAFE = /^[A-Za-z0-9_+\-*/(). ]+$/;
const rows = [...inputs, ...computed];
const rowOf = new Map(rows.map((row, index) => [row.id, index + 2]));

const substitute = (expr, pick) =>
  expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => {
    if (!rowOf.has(id)) throw new Error("unknown id " + id + " in " + expr);
    return pick(id);
  });

const evaluate = (scenario) => {
  const values = new Map(inputs.map((row) => [row.id, row[scenario] ?? row.base]));
  for (const row of computed) {
    if (!SAFE.test(row.readable)) throw new Error("only arithmetic is allowed in " + row.id);
    values.set(row.id, Function("return (" + substitute(row.readable, (id) => "(" + values.get(id) + ")") + ")")());
  }
  return values;
};

const values = { base: evaluate("base"), conservative: evaluate("conservative") };
const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
};
const csv = (lines) => lines.map((line) => line.map(csvCell).join(",")).join("\n") + "\n";
const formula = (row, column) => "=" + substitute(row.readable, (id) => column + rowOf.get(id));

writeFileSync(
  STEM + ".csv",
  csv([
    ["id", "unit", "type", "source", "date", "base", "conservative", "readable"],
    ...inputs.map((row) => [row.id, row.unit, row.type, row.source, row.date, row.base, row.conservative ?? row.base, ""]),
    ...computed.map((row) => [row.id, row.unit, "COMPUTED", "", "", formula(row, SCENARIOS.base), formula(row, SCENARIOS.conservative), row.readable]),
  ]),
);

const fits = (item) => item.accepted <= item.next_value;
writeFileSync(
  STEM.replace(/-cost-model$/, "-cost-limits") + ".csv",
  csv([
    ["provider", "limit", "value", "unit", "accepted", "next_layer", "next_value", "source", "date"],
    ...limits.map((item) => [item.provider, item.limit, item.value, item.unit, item.accepted, item.next_layer, item.next_value, item.source, item.date]),
  ]),
);

const round = (value) => (Number.isFinite(value) ? Math.round(value * 10000) / 10000 : String(value));
const marked = (row) => (row.type === "ASSUMPTION" ? "**ASSUMPTION** " : row.type === "OPINION" ? "**OPINION** " : "");
const pair = (id) => round(values.base.get(id)) + " / " + round(values.conservative.get(id));
const table = (header, body) => ["| " + header.join(" | ") + " |", "|" + header.map(() => "---").join("|") + "|", ...body.map((line) => "| " + line.join(" | ") + " |")];

writeFileSync(
  STEM + ".md",
  [
    "# " + TEXT.title,
    "",
    TEXT.intro.replace("{file}", SELF.replace(/^.*[\\/]/, "")).replace("{date}", DATE),
    "",
    "## " + TEXT.unit, "", pair(KEYS.unit), "",
    "## " + TEXT.fixed, "", pair(KEYS.fixed), "",
    "## " + TEXT.breakEven, "", pair(KEYS.breakEven), "",
    "## " + TEXT.scenarios, "",
    ...table(["id", TEXT.base, TEXT.conservative, "type", "unit"], rows.map((row) => [marked(row) + row.id, round(values.base.get(row.id)), round(values.conservative.get(row.id)), row.type ?? "COMPUTED", row.unit])),
    "",
    "## " + TEXT.assumptions, "",
    ...inputs.filter((row) => row.type !== "FACT").map((row) => "- " + marked(row) + row.id + " = " + pair(row.id) + " " + row.unit),
    "",
    "## " + TEXT.limits, "",
    ...table(["provider", "limit", "value", "accepted", "next layer", "next layer handles", "ok"], limits.map((item) => [item.provider, item.limit, item.value + " " + item.unit, item.accepted, item.next_layer, item.next_value, fits(item) ? "yes" : "NO"])),
    "",
    "## " + TEXT.measure, "",
    ...measure.map((id) => "- " + id),
    "",
  ].join("\n"),
);

if (!limits.every(fits)) process.exitCode = 1;
`;

export const costScript = (t: Translate, topic: string, date: string): string =>
  SCRIPT.replace(
    "__TEXT__",
    JSON.stringify({
      title: t("cost.report.title", { topic }),
      intro: t("cost.report.intro"),
      unit: t("cost.report.unit"),
      fixed: t("cost.report.fixed"),
      breakEven: t("cost.report.break_even"),
      scenarios: t("cost.report.scenarios"),
      base: t("cost.report.base"),
      conservative: t("cost.report.conservative"),
      assumptions: t("cost.report.assumptions"),
      limits: t("cost.report.limits"),
      measure: t("cost.report.measure"),
    }),
  ).replace("__DATE__", date);
