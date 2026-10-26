import { isRecord, optionalString, parseJsonObject } from "../../core/parsed.js";
import { logEvent } from "../../evidence/log.js";
import { human, projectPaths } from "../../gate/hooks/common.js";
import type { HookHandler, HookInput } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { maskText } from "../../mask/mask.js";
import { toolInput, toolName } from "../../secrets/guards/tool-input.js";
import { dialectOf } from "../../shell/normalize.js";
import type { FmPaths } from "../../task/paths.js";
import { SHELL_TOOLS } from "../context.js";
import { isSensitiveCommand } from "./sensitive.js";

const REWRITTEN = "rewritten.json";

const toolUseId = (input: HookInput): string | undefined => {
  const id = optionalString(input.payload.raw, "tool_use_id");
  return id !== undefined && /^[A-Za-z0-9_-]{1,120}$/.test(id) ? id : undefined;
};

const commandOf = (input: HookInput): string | undefined =>
  SHELL_TOOLS.has(toolName(input.payload)) ? optionalString(toolInput(input.payload), "command") : undefined;

const checkedPath = (paths: FmPaths, id: string) => paths.cache(`checked-${id}.json`);

const same = (left: string, right: string): boolean =>
  left.trim().replace(/\s+/g, " ") === right.trim().replace(/\s+/g, " ");

export const recordChecked: HookHandler = (input) => {
  const id = toolUseId(input);
  const command = commandOf(input);
  const paths = projectPaths(input);
  if (id === undefined || command === undefined || paths === undefined) return { kind: "allow" };
  if (!isSensitiveCommand(command, dialectOf(toolName(input.payload)))) return { kind: "allow" };
  input.runtime.writeText(checkedPath(paths, id), `${JSON.stringify({ command })}\n`);
  return { kind: "allow" };
};

export const compareRan: HookHandler = (input) => {
  const id = toolUseId(input);
  const paths = projectPaths(input);
  if (id === undefined || paths === undefined) return { kind: "allow" };
  const stored = input.runtime.readText(checkedPath(paths, id));
  if (!stored.ok) return { kind: "allow" };
  input.runtime.remove(checkedPath(paths, id));
  const parsed = parseJsonObject(stored.value);
  const checked = parsed.ok ? optionalString(parsed.value, "command") : undefined;
  const ran = commandOf(input) ?? "";
  if (checked === undefined || same(checked, ran)) return { kind: "allow" };
  const record = {
    tool: toolName(input.payload),
    checked: maskText(checked),
    ran: maskText(ran),
    sessionId: input.payload.sessionId ?? null,
  };
  logEvent(input.runtime, paths, "input_rewritten", record);
  input.runtime.writeText(paths.cache(REWRITTEN), `${JSON.stringify(record)}\n`);
  return {
    kind: "block",
    reason: modelReason(input.t, "gate.guard.rewrite", { checked: record.checked, ran: record.ran }),
    human: input.t("gate.guard.rewrite.human"),
  };
};

export const rewriteStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined) return { kind: "allow" };
  const stored = input.runtime.readText(paths.cache(REWRITTEN));
  const parsed = stored.ok ? parseJsonObject(stored.value) : undefined;
  if (parsed?.ok !== true || !isRecord(parsed.value)) return { kind: "allow" };
  const sessionId = optionalString(parsed.value, "sessionId");
  if (sessionId === undefined || sessionId !== input.payload.sessionId) return { kind: "allow" };
  const params = {
    checked: optionalString(parsed.value, "checked") ?? "",
    ran: optionalString(parsed.value, "ran") ?? "",
  };
  return {
    kind: "block",
    reason: modelReason(input.t, "gate.guard.rewrite", params),
    output: { systemMessage: human(input.t("gate.guard.rewrite.human")) },
    persistent: true,
  };
};
