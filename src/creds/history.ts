import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { recordIncident } from "../secrets/incidents.js";
import { isEnvFile, isEnvTemplate } from "./env-files.js";

export interface HistoryEnv {
  readonly file: string;
  readonly commit: string;
}

export const ENV_HISTORY_RULE = "env-file-in-history";

export const envInHistory = (runtime: Pick<Runtime, "git">, root: AbsolutePath): readonly HistoryEnv[] => {
  const log = runtime.git(
    [
      "log",
      "--all",
      "--diff-filter=A",
      "--name-only",
      "--format=commit:%H",
      "--",
      ":(glob)**/.env",
      ":(glob)**/.env.*",
    ],
    root,
  );
  if (!log.found || !log.ok) return [];
  const found = new Map<string, string>();
  let commit = "";
  for (const line of log.stdout.split("\n")) {
    if (line.startsWith("commit:")) commit = line.slice("commit:".length);
    else if (line !== "" && isEnvFile(line) && !isEnvTemplate(line)) found.set(line, commit);
  }
  return [...found.entries()]
    .map(([file, first]) => ({ file, commit: first }))
    .sort((a, b) => a.file.localeCompare(b.file));
};

export const openHistoryIncidents = (
  runtime: Runtime,
  root: AbsolutePath,
  found: readonly HistoryEnv[],
  by: string,
): readonly string[] =>
  found.flatMap((item) => {
    const incident = recordIncident(
      runtime,
      root,
      {
        rule: ENV_HISTORY_RULE,
        where: item.file,
        fingerprint: item.file,
        source: "history",
        state: "aberto",
        firstCommit: item.commit,
      },
      by,
    );
    return incident.ok ? [incident.value.id] : [];
  });
