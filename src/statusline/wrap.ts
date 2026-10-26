import type { AbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export const WRAP_CACHE = "statusline.json";
const KEEP = 20;

const cached = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Readonly<Record<string, string>> => {
  const raw = readJsonFile(runtime, paths.cache(WRAP_CACHE))?.["sessions"];
  return isRecord(raw)
    ? Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
};

const remember = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  session: string,
  text: string,
): void => {
  const sessions = Object.entries({ ...cached(runtime, paths), [session]: text }).slice(-KEEP);
  writeJsonFile(runtime, paths.cache(WRAP_CACHE), { sessions: Object.fromEntries(sessions) });
};

export interface WrapRequest {
  readonly command: string;
  readonly input: string;
  readonly cwd: AbsolutePath;
  readonly timeoutMs: number;
  readonly session: string;
}

export const runWrapped = (
  runtime: Pick<Runtime, "exec" | "readText" | "writeText">,
  paths: FmPaths | undefined,
  request: WrapRequest,
): string => {
  const result = runtime.exec({
    command: request.command,
    args: [],
    cwd: request.cwd,
    timeoutMs: request.timeoutMs,
    shell: true,
    input: request.input,
  });
  const text = result.stdout.replace(/\s+$/, "");
  if (!result.timedOut && result.found) {
    if (paths !== undefined) remember(runtime, paths, request.session, text);
    return text;
  }
  return paths === undefined ? "" : (cached(runtime, paths)[request.session] ?? "");
};
