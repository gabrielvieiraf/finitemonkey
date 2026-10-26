import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { type Check, finding } from "./types.js";

const LF_RULE = /^\*\s.*\beol=lf\b/m;

export const checkLineEndings: Check = ({ root, runtime }) => {
  const autocrlf = runtime.git(["config", "--get", "core.autocrlf"], root);
  if (!autocrlf.ok || autocrlf.stdout.trim().toLowerCase() !== "true") return [];
  const attributes = runtime.readText(toAbsolutePath(join(root, ".gitattributes")));
  if (attributes.ok && LF_RULE.test(attributes.value)) return [];
  return [
    finding("git.autocrlf", "warn", "doctor.git.autocrlf", { file: ".gitattributes" }, "doctor.git.fix_autocrlf"),
  ];
};
