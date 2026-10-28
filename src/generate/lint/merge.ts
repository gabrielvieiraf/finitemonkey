import { esImport } from "../js.js";
import { LINT_CONFIG_FILE } from "./config.js";

export const IMPORT_LINE = esImport("{ finitemonkey }", `./${LINT_CONFIG_FILE}`);
export const SPREAD_LINE = "...finitemonkey,";

const EXPORT_DEFAULT = /^export\s+default\s+/m;
const CLOSING = /^[\])]\s*\)?\s*;?\s*$/;
const IMPORT_END = /^(?:import\s+["'][^"']+["'];?|.*\bfrom\s+["'][^"']+["'];?)\s*$/;

export const freshEslintConfig = (): string => `${IMPORT_LINE}\n\nexport default [${SPREAD_LINE}];\n`;

const withImport = (text: string): string => {
  const lines = text.split("\n");
  const exportAt = lines.findIndex((line) => EXPORT_DEFAULT.test(line));
  const before = lines.slice(0, exportAt < 0 ? lines.length : exportAt);
  const last = before.reduce((found, line, index) => (IMPORT_END.test(line) ? index : found), -1);
  if (last < 0) return `${IMPORT_LINE}\n\n${text}`;
  return [...lines.slice(0, last + 1), IMPORT_LINE, ...lines.slice(last + 1)].join("\n");
};

const closingIndex = (text: string, from: number): number | undefined => {
  for (let index = text.length - 1; index > from; index -= 1) {
    const char = text.charAt(index);
    if (char === "]" || char === ")") return CLOSING.test(text.slice(index)) ? index : undefined;
    if (!/[\s;]/.test(char)) return undefined;
  }
  return undefined;
};

export const mergeEslintConfig = (text: string): string | undefined => {
  if (text.includes(LINT_CONFIG_FILE)) return text;
  const start = EXPORT_DEFAULT.exec(text);
  if (start === null) return undefined;
  const close = closingIndex(text, start.index);
  if (close === undefined) return undefined;
  const head = text.slice(0, close).trimEnd();
  const separator = /[,[(]$/.test(head) ? "" : ",";
  return withImport(`${head}${separator}\n  ${SPREAD_LINE}\n${text.slice(close)}`);
};
