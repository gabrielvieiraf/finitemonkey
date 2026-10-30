import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

const LIMIT = 500;

export const onceFor = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  file: string,
  signature: string,
): boolean => {
  const raw = readJsonFile(runtime, paths.cache(file))?.["seen"];
  const seen = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  if (seen.includes(signature)) return false;
  writeJsonFile(runtime, paths.cache(file), { seen: [...seen, signature].slice(-LIMIT) });
  return true;
};
