import { fileURLToPath } from "node:url";

import { toAbsolutePath } from "./brand.js";
import { isRecord, parseJson } from "./parsed.js";
import type { Runtime } from "./runtime.js";

export const UNKNOWN_VERSION = "0.0.0-unknown";

export const readPackageVersion = (readText: Runtime["readText"], moduleUrl: string): string => {
  const text = readText(toAbsolutePath(fileURLToPath(new URL("../package.json", moduleUrl))));
  if (!text.ok) return UNKNOWN_VERSION;
  const parsed = parseJson(text.value);
  if (!parsed.ok || !isRecord(parsed.value)) return UNKNOWN_VERSION;
  const version = parsed.value["version"];
  return typeof version === "string" ? version : UNKNOWN_VERSION;
};
