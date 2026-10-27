import { PROD_PROGRAMS } from "../../prod/guard.js";
import { normalizeCommand } from "../../shell/normalize.js";
import type { Dialect } from "../../shell/types.js";
import { detectBypass } from "../bypass/detect.js";

const READ_ONLY_GIT = new Set(["status", "log", "diff", "show", "blame", "describe", "rev-parse", "ls-files", "fetch"]);
const REMOVERS = new Set(["rm", "rmdir", "remove-item", "del", "rd"]);
const ENV_FILE = /(^|[\s"'=/])\.env(\.[A-Za-z0-9_-]+)?(?=$|[\s"';|&)])/;

export const isSensitiveCommand = (text: string, dialect: Dialect = "bash"): boolean => {
  if (detectBypass(text).length > 0 || ENV_FILE.test(text)) return true;
  return normalizeCommand(text, dialect).commands.some((command) => {
    if (PROD_PROGRAMS.has(command.program) || REMOVERS.has(command.program)) return true;
    if (command.program !== "git") return false;
    const sub = command.args.find((arg) => !arg.startsWith("-")) ?? "";
    return sub !== "" && !READ_ONLY_GIT.has(sub);
  });
};
