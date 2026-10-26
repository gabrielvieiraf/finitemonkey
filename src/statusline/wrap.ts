import type { AbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { nodeShell, type Shell } from "./node-shell.js";

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

export const runWrapped = async (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths | undefined,
  request: WrapRequest,
  shell: Shell = nodeShell,
): Promise<string> => {
  const result = await shell(request.command, request.input, request.cwd, request.timeoutMs);
  if (result.text !== undefined) {
    const text = result.text.replace(/\s+$/, "");
    if (paths !== undefined) remember(runtime, paths, request.session, text);
    return text;
  }
  return paths === undefined ? "" : (cached(runtime, paths)[request.session] ?? "");
};
