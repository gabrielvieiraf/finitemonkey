import { relative } from "node:path";

import { pathTokens } from "../conceitos/recognize.js";
import type { JsonObject } from "../core/parsed.js";
import { projectPaths } from "../gate/hooks/common.js";
import { FILE_TOOLS, SHELL_TOOLS } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { readState } from "../task/state.js";
import { openHelps, type OutcomeReason, recordOutcome } from "./horizon-outcome.js";
import type { HorizonEntry } from "./types.js";

export type Act =
  { readonly kind: "ran"; readonly command: string } | { readonly kind: "edited"; readonly file: string };

const squeezed = (text: string): string => text.trim().replace(/\s+/g, " ");

const ranCheck = (help: HorizonEntry, command: string): boolean => {
  const suggested = squeezed(help.answer ?? "");
  return help.criterion === "check" && suggested !== "" && squeezed(command).includes(suggested);
};

const namesFile = (help: HorizonEntry, file: string): boolean =>
  pathTokens(`${help.text} ${help.answer ?? ""}`).some(
    (token) => token.includes(".") && (file === token || file.endsWith(`/${token}`)),
  );

export const actedOn = (help: HorizonEntry, act: Act): OutcomeReason | undefined => {
  if (act.kind === "ran") return ranCheck(help, act.command) ? "ran_check" : undefined;
  return namesFile(help, act.file) ? "edited" : undefined;
};

const actOf = (raw: JsonObject, root: string): Act | undefined => {
  const tool = toolName(raw);
  const input = toolInput(raw);
  if (SHELL_TOOLS.has(tool)) {
    const command = textField(input, "command");
    return command === undefined ? undefined : { kind: "ran", command };
  }
  if (!FILE_TOOLS.has(tool)) return undefined;
  const file = textField(input, "file_path", "notebook_path");
  return file === undefined ? undefined : { kind: "edited", file: relative(root, file).replaceAll("\\", "/") };
};

export const horizonActed: HookHandler = (input) => {
  const allow = { kind: "allow" } as const;
  const paths = projectPaths(input);
  if (paths === undefined) return allow;
  const act = actOf(input.payload.raw, paths.root);
  const task = act === undefined ? undefined : readState(input.runtime, paths).active;
  if (act === undefined || task === undefined) return allow;
  for (const help of openHelps(input.runtime, paths, task)) {
    const reason = actedOn(help, act);
    if (reason !== undefined) recordOutcome(input.runtime, paths, help, reason);
  }
  return allow;
};

export const HORIZON_HANDLERS: HookHandlers = { PostToolUse: [horizonActed] };
