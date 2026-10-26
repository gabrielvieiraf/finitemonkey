import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { configAt, parseConfigYaml } from "../git/project-config.js";
import { AGENTS_FILE, AGENTS_MAX_LINES, CONFIG_FILE } from "../install/layout.js";
import { type Check, finding } from "./types.js";

const ceilingOf = (config: string | undefined): number => {
  const value = configAt(parseConfigYaml(config ?? ""), "memory", "maxLines");
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : AGENTS_MAX_LINES;
};

const lineCount = (text: string): number => text.replace(/\r?\n$/, "").split(/\r?\n/).length;

export const checkAgentsFile: Check = ({ root, runtime }) => {
  const text = runtime.readText(toAbsolutePath(join(root, AGENTS_FILE)));
  if (!text.ok) return [];
  const config = runtime.readText(toAbsolutePath(join(root, CONFIG_FILE)));
  const max = ceilingOf(config.ok ? config.value : undefined);
  const lines = lineCount(text.value);
  const params = { file: AGENTS_FILE, lines, max };
  return lines > max
    ? [finding("memory.agents_lines", "fail", "doctor.memory.too_long", params, "doctor.memory.fix_too_long")]
    : [finding("memory.agents_lines", "ok", "doctor.memory.lines", params)];
};
