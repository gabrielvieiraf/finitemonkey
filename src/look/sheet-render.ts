import { type Sheet, type SheetElement, type SheetVariable, type SheetView, UNMEASURED } from "./sheet.js";

const PLAN_WIDTH = 560;
const STROKES = [2, 1.25, 0.75] as const;

const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

const refOf = (
  variables: readonly SheetVariable[],
  kind: SheetVariable["kind"],
  px: number | null | undefined,
): string => {
  if (px === null || px === undefined) return UNMEASURED;
  if (px === 0) return "0";
  return variables.find((variable) => variable.kind === kind && variable.px === px)?.name ?? `${String(px)}px`;
};

const label = (element: SheetElement, variables: readonly SheetVariable[]): string => {
  const pad = ["padding-top", "padding-right", "padding-bottom", "padding-left"]
    .map((name) => refOf(variables, "space", element.values[name]))
    .join(" ");
  const gap = refOf(variables, "space", element.values["row-gap"]);
  return `${element.slot} · p ${pad} · gap ${gap} · r ${refOf(variables, "radius", element.values["radius"])}`;
};

const plan = (view: SheetView, variables: readonly SheetVariable[]): string => {
  const right = Math.max(1, ...view.elements.map((element) => element.box.x + element.box.w));
  const bottom = Math.max(1, ...view.elements.map((element) => element.box.y + element.box.h));
  const k = PLAN_WIDTH / right;
  const shapes = view.elements.map((element) => {
    const stroke = STROKES[Math.min(element.depth, STROKES.length - 1)] ?? 0.75;
    const radius = (element.values["radius"] ?? 0) * k;
    const box = element.box;
    const dash = element.layer === undefined ? "" : ' fill="url(#hatch)"';
    return `<rect x="${String(box.x * k)}" y="${String(box.y * k)}" width="${String(box.w * k)}" height="${String(box.h * k)}" rx="${String(radius)}" stroke="#000" stroke-width="${String(stroke)}" fill="none"${dash}><title>${escape(label(element, variables))}</title></rect>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(PLAN_WIDTH)}" height="${String(bottom * k + 2)}" viewBox="-1 -1 ${String(PLAN_WIDTH + 2)} ${String(bottom * k + 2)}"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6L6 0" stroke="#000" stroke-width="0.5"/></pattern></defs>${shapes.join("")}</svg>`;
};

const rows = (sheet: Sheet, view: SheetView): string => {
  const keys = [...new Set(sheet.views.flatMap((item) => item.elements.map((element) => element.key)))];
  return keys
    .map((key) => {
      const element = view.elements.find((item) => item.key === key);
      const text = element === undefined ? UNMEASURED : label(element, sheet.variables);
      return `<tr><td><code>${escape(key)}</code></td><td>${escape(text)}</td><td>${element?.layer ?? ""}</td></tr>`;
    })
    .join("");
};

const placement = (view: SheetView): string =>
  view.placement === null
    ? UNMEASURED
    : `x ${String(Math.round(view.placement.x))}px · w ${String(Math.round(view.placement.w))}px · ${view.placement.fill ? "FILL" : "HUG"}`;

const variableRow = (variable: SheetVariable): string =>
  `<tr><td>${variable.name}</td><td>${variable.kind}</td><td>${String(variable.px)}px</td><td>${variable.token === undefined ? (variable.offScale ? "<b>off-scale</b>" : "—") : escape(variable.token)}</td></tr>`;

const STYLE =
  "body{font:13px monospace;color:#000;background:#fff;margin:16px}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #000;padding:2px 6px;text-align:left}section{margin:16px 0;border-top:2px solid #000}h1,h2{font-weight:bold}";

export const renderSheet = (sheet: Sheet): string =>
  [
    `<!doctype html><html><head><meta charset="utf-8"><title>sheet ${escape(sheet.route)}</title><style>${STYLE}</style></head><body>`,
    `<h1>${escape(sheet.route)} · ${escape(sheet.selector)} · tree ${escape(sheet.tree.slice(0, 12))}</h1>`,
    "<h2>Variables</h2><table><tr><th>name</th><th>kind</th><th>value</th><th>token</th></tr>",
    sheet.variables.map(variableRow).join(""),
    "</table>",
    sheet.issues.length === 0
      ? ""
      : `<h2>Issues</h2><ul>${sheet.issues.map((item) => `<li>${item.rule} <code>${escape(item.key)}</code>: ${escape(item.detail)}</li>`).join("")}</ul>`,
    ...sheet.views.map(
      (view) =>
        `<section><h2>${String(view.width)}px · ${escape(view.state)} · ${placement(view)}</h2>${plan(view, sheet.variables)}<table><tr><th>element</th><th>slot and dimensions</th><th>layer</th></tr>${rows(sheet, view)}</table></section>`,
    ),
    "</body></html>",
  ].join("\n");
