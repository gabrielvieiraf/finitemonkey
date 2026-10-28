import { logEvent } from "../evidence/log.js";
import { projectPaths, sessionCwd } from "../gate/hooks/common.js";
import { loadProjectConfig } from "../git/project-config.js";
import { deny } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { maskText } from "../mask/mask.js";
import { dialectOf, normalizeCommand } from "../shell/normalize.js";
import { acquireSlot, heavyLimit, type Holder, isHeavy, releaseSlots, slotPath, staleMs } from "./heavy.js";

export const HEAVY_FEATURE = "heavy-lock";
const SHELLS = new Set(["Bash", "PowerShell"]);
const COMMAND_MAX = 120;

const allow = { kind: "allow" } as const;

const heavyCommand = (input: HookInput): string | undefined => {
  const raw = input.payload.raw;
  const tool = toolName(raw);
  if (!SHELLS.has(tool)) return undefined;
  const command = textField(toolInput(raw), "command") ?? "";
  return normalizeCommand(command, dialectOf(tool)).commands.some(isHeavy) ? command : undefined;
};

const holderLine = (holder: Holder): string => `${holder.command} in ${holder.cwd} since ${holder.at}`;

const busy = (input: HookInput, limit: number, holders: readonly Holder[]): HookDecision => {
  const { t } = input;
  const params = { limit, holders: holders.map(holderLine).join("; ") || "-" };
  return deny(modelReason(t, "wt.heavy", params), t("wt.heavy.human", params));
};

export const heavyGuard: HookHandler = (input) => {
  const command = heavyCommand(input);
  if (command === undefined) return allow;
  const paths = projectPaths(input);
  const config = paths === undefined ? {} : loadProjectConfig(input.runtime, paths.root);
  const limit = heavyLimit(input.env, config);
  if (limit === 0) return allow;
  const { runtime } = input;
  const id = textField(input.payload.raw, "tool_use_id") ?? `${input.payload.sessionId ?? "session"}-${runtime.now()}`;
  const holder = { id, cwd: sessionCwd(input), command: maskText(command).slice(0, COMMAND_MAX), at: runtime.now() };
  const result = acquireSlot(runtime, limit, holder, staleMs(config));
  if (result.kind === "busy") {
    if (paths !== undefined) logEvent(runtime, paths, "wt.heavy_waited", { limit, holders: result.holders.length });
    return busy(input, limit, result.holders);
  }
  if (toolInput(input.payload.raw)["run_in_background"] === true) runtime.remove(slotPath(runtime, result.slot));
  return allow;
};

export const heavyRelease: HookHandler = (input) => {
  const id = textField(input.payload.raw, "tool_use_id");
  if (id !== undefined && heavyCommand(input) !== undefined) releaseSlots(input.runtime, id);
  return allow;
};

export const HEAVY_HANDLERS: HookHandlers = {
  PreToolUse: [heavyGuard],
  PostToolUse: [heavyRelease],
  PostToolUseFailure: [heavyRelease],
  PermissionDenied: [heavyRelease],
};
