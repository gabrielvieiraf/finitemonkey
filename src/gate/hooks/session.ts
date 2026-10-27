import { nowMs } from "../../core/clock.js";
import type { Runtime } from "../../core/runtime.js";
import { textField } from "../../hooks/fields.js";
import type { HookHandler, HookInput } from "../../hooks/handlers.js";
import type { Translate } from "../../i18n/translate.js";
import type { FmPaths } from "../../task/paths.js";
import { readState } from "../../task/state.js";
import { readBaseline, writeSession } from "../baseline.js";
import { gitAt, headSha, treeHash } from "../git.js";
import { allowWith, contextOutput, human, projectPaths } from "./common.js";
import { recordConfigHooks } from "./config.js";
import { cachedPrs, openPrsLine } from "./prs.js";
import { startupRoutine } from "./routine.js";
import { saveSnapshot, snapshotFacts } from "./snapshot.js";
import { readGateStatus } from "./status.js";

const REINJECT_SOURCES = new Set(["compact", "resume"]);

const startBaseline = (runtime: Runtime, paths: FmPaths, tree: string): void => {
  if (readBaseline(runtime, paths)?.treeHash !== tree) runtime.spawnSelf(["gate", "--baseline"], paths.root);
};

const notRunLine = (t: Translate, runtime: Runtime, paths: FmPaths): readonly string[] => {
  const status = readGateStatus(runtime, paths);
  if (status?.status === "not_run") return [t("gate.human.last_not_run", { at: status.at, detail: status.detail })];
  if (status?.status === "not_done") return [t("gate.human.last_not_done", { at: status.at, detail: status.detail })];
  return [];
};

const markSession = (input: HookInput, paths: FmPaths): void => {
  const { runtime } = input;
  const sessionId = input.payload.sessionId;
  const git = gitAt(runtime, paths.root);
  if (sessionId === undefined || headSha(git) === undefined) return;
  const tree = treeHash(git);
  if (tree === undefined) return;
  writeSession(runtime, paths, { sessionId, startTree: tree, at: nowMs(runtime) });
  startBaseline(runtime, paths, tree);
  if (cachedPrs(runtime, paths) === undefined) runtime.spawnSelf(["gate", "--prs"], paths.root);
};

export const sessionStart: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined) return { kind: "allow" };
  const { t, runtime } = input;
  const source = textField(input.payload.raw, "source") ?? "startup";
  if (source !== "compact") markSession(input, paths);
  recordConfigHooks(runtime, paths, input.env);
  const lines = [...notRunLine(t, runtime, paths), ...openPrsLine(t, runtime, paths)];
  const systemMessage = lines.length === 0 ? undefined : human(lines.join(" "));
  const snapshot = REINJECT_SOURCES.has(source) ? snapshotFacts(t, readState(runtime, paths).snapshot) : undefined;
  const routine = startupRoutine(input, paths);
  const facts = [snapshot, routine].filter((part): part is string => part !== undefined).join("\n");
  if (facts !== "") return allowWith(contextOutput("SessionStart", facts, systemMessage));
  return systemMessage === undefined ? { kind: "allow" } : allowWith({ systemMessage });
};

export const preCompact: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths !== undefined) saveSnapshot(input.runtime, paths, input.t, input.payload.sessionId);
  return { kind: "allow" };
};
