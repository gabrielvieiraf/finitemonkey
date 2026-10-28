import { isRecord } from "../core/parsed.js";
import { human, projectPaths } from "../gate/hooks/common.js";
import { parseShell } from "../guards/shell.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { loadDeployConfig } from "./config.js";
import { DEPLOY_PUSH_FILE, takeReport } from "./report.js";

export const DEPLOY_FEATURE = "deploy";
const SHELLS = new Set(["Bash", "PowerShell"]);

const allow = { kind: "allow" } as const;

const isPush = (command: string): boolean =>
  parseShell(command).some((simple) => {
    const args = simple.argv;
    const git = args.findIndex((arg) => /(^|[\\/])git(\.exe)?$/.test(arg));
    if (git < 0) return false;
    const rest = args.slice(git + 1).filter((arg, index, all) => !arg.startsWith("-") && all[index - 1] !== "-C");
    return rest[0] === "push";
  });

const succeeded = (raw: HookInput["payload"]["raw"]): boolean => {
  const response = raw["tool_response"];
  if (!isRecord(response)) return true;
  const code = response["exitCode"] ?? response["exit_code"];
  return code === undefined || code === 0;
};

const projectOf = (input: HookInput): FmPaths | undefined => {
  const paths = projectPaths(input);
  return paths !== undefined && input.runtime.stat(paths.dir)?.kind === "dir" ? paths : undefined;
};

export const deployPushSeen: HookHandler = (input) => {
  const raw = input.payload.raw;
  if (!SHELLS.has(toolName(raw)) || !isPush(textField(toolInput(raw), "command") ?? "") || !succeeded(raw))
    return allow;
  const paths = projectOf(input);
  if (paths === undefined || loadDeployConfig(input.runtime, paths.root) === undefined) return allow;
  writeJsonFile(input.runtime, paths.cache(DEPLOY_PUSH_FILE), { at: input.runtime.now(), started: false });
  return allow;
};

const reportLine = (input: HookInput, paths: FmPaths): HookDecision => {
  const mode = featureMode(input.runtime, paths, DEPLOY_FEATURE);
  const line = takeReport(input.runtime, paths);
  if (line === undefined) return allow;
  if (mode !== "active") {
    recordFeatureShadow(input.runtime, paths, DEPLOY_FEATURE, { line });
    return allow;
  }
  return { kind: "allow", output: { systemMessage: human(line) } };
};

const startCheck = (input: HookInput, paths: FmPaths): void => {
  const push = readJsonFile(input.runtime, paths.cache(DEPLOY_PUSH_FILE));
  if (push?.["started"] !== false) return;
  writeJsonFile(input.runtime, paths.cache(DEPLOY_PUSH_FILE), { ...push, started: true });
  input.runtime.spawnSelf(["deploy", "status", "--wait", "--report"], paths.root);
};

export const deployStop: HookHandler = (input) => {
  const paths = projectOf(input);
  if (paths === undefined) return allow;
  startCheck(input, paths);
  return reportLine(input, paths);
};

export const deployPrompt: HookHandler = (input) => {
  const paths = projectOf(input);
  return paths === undefined ? allow : reportLine(input, paths);
};

export const DEPLOY_HANDLERS: HookHandlers = {
  PostToolUse: [deployPushSeen],
  Stop: [deployStop],
  UserPromptSubmit: [deployPrompt],
};
