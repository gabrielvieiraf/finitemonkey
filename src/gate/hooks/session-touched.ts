import { isAbsolute } from "node:path";

import type { Runtime } from "../../core/runtime.js";
import { readEntries, signalFiles } from "../../signals/store.js";
import type { FmPaths } from "../../task/paths.js";

const insideRepo = (file: string): boolean => file !== "" && !isAbsolute(file) && !file.startsWith("..");

export const sessionTouchedRepo = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  sessionId: string | undefined,
): boolean => {
  if (sessionId === undefined || sessionId === "") return true;
  return readEntries(runtime, signalFiles(paths)).some(
    (entry) =>
      entry.session === sessionId && (entry.kind === "edit" || entry.kind === "bash_write") && insideRepo(entry.file),
  );
};
