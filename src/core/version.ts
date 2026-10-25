import { fileURLToPath } from "node:url";

import { toAbsolutePath } from "./brand.js";
import { isRecord, parseJson } from "./parsed.js";
import type { Runtime } from "./runtime.js";

export const UNKNOWN_VERSION = "0.0.0-unknown";

export const VERSION_SOURCES = ["../package.json", "../.claude-plugin/plugin.json"] as const;

const versionAt = (readText: Runtime["readText"], moduleUrl: string, relative: string): string | undefined => {
  const text = readText(toAbsolutePath(fileURLToPath(new URL(relative, moduleUrl))));
  if (!text.ok) return undefined;
  const parsed = parseJson(text.value);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const version = parsed.value["version"];
  return typeof version === "string" ? version : undefined;
};

export const readPackageVersion = (readText: Runtime["readText"], moduleUrl: string): string => {
  for (const relative of VERSION_SOURCES) {
    const version = versionAt(readText, moduleUrl, relative);
    if (version !== undefined) return version;
  }
  return UNKNOWN_VERSION;
};
