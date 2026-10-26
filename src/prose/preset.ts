import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { CONFIG_FILE, parsePreset, type Preset } from "../install/layout.js";

const PRESET_LINE = /^preset:\s*([A-Za-z0-9_-]+)\s*$/m;

export const presetFromConfig = (text: string): Preset => parsePreset(PRESET_LINE.exec(text)?.[1]) ?? "neutral";

export const projectPreset = (runtime: Runtime, root: AbsolutePath): Preset => {
  const config = runtime.readText(toAbsolutePath(CONFIG_FILE, root));
  return config.ok ? presetFromConfig(config.value) : "neutral";
};
