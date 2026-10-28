import type { JsonObject } from "../core/parsed.js";
import { writtenPaths } from "../guards/self/protected.js";
import { parseShell } from "../guards/shell.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import { normalizeCommand } from "../shell/normalize.js";

export const FILE_WRITERS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

const POWERSHELL_WRITERS = new Set([
  "set-content",
  "add-content",
  "clear-content",
  "out-file",
  "new-item",
  "copy-item",
  "move-item",
  "rename-item",
  "remove-item",
  "tee-object",
]);

const DISCARDED = /^(?:\/dev\/null|&\d|\$null|nul)$/i;

const realTargets = (targets: readonly string[]): readonly string[] =>
  targets.filter((target) => target !== "" && !DISCARDED.test(target));

const powershellWrites = (command: string): boolean =>
  normalizeCommand(command, "powershell").commands.some(
    (item) =>
      POWERSHELL_WRITERS.has(item.program) ||
      realTargets(item.redirects.filter((redirect) => redirect.op !== "<").map((redirect) => redirect.target)).length >
        0,
  );

const bashWrites = (command: string): boolean =>
  parseShell(command).some((item) => realTargets(writtenPaths(item)).length > 0);

export const writesFiles = (raw: JsonObject): boolean => {
  const tool = toolName(raw);
  if (FILE_WRITERS.has(tool)) return true;
  const command = textField(toolInput(raw), "command") ?? "";
  if (tool === "PowerShell") return powershellWrites(command);
  return tool === "Bash" && bashWrites(command);
};
