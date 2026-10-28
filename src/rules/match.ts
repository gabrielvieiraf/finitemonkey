import { globToRegExp } from "../core/glob.js";
import { toPosixPath } from "../core/posix-path.js";
import { hasAttribution } from "../githooks/commit-msg.js";
import { normalizeCommand } from "../shell/normalize.js";
import type { Dialect } from "../shell/types.js";
import type { ProjectRule, TextTarget } from "./types.js";

const isSubsequence = (wanted: readonly string[], args: readonly string[]): boolean => {
  let position = 0;
  for (const arg of args) if (arg === wanted[position]) position += 1;
  return position === wanted.length;
};

export const commandMatches = (rule: ProjectRule, text: string, dialect: Dialect = "bash"): boolean => {
  if (rule.detector?.kind !== "command") return false;
  const [program, ...rest] = rule.detector.command.trim().split(/\s+/);
  return normalizeCommand(text, dialect).commands.some(
    (command) => command.program === program && isSubsequence(rest, command.args),
  );
};

export const pathMatches = (rule: ProjectRule, tool: string, path: string): boolean => {
  if (rule.detector?.kind !== "path" || !rule.detector.tools.includes(tool)) return false;
  const file = toPosixPath(path).replace(/^\.\//, "");
  const regex = globToRegExp(rule.detector.path);
  return regex.test(file) || regex.test(file.slice(file.lastIndexOf("/") + 1));
};

const patternOf = (source: string): RegExp | undefined => {
  try {
    return new RegExp(source.replace(/^\(\?i\)/, ""), "im");
  } catch {
    return undefined;
  }
};

const withoutCodeBlocks = (text: string): string => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

const ROBOT = "\u{1F916}";

export const attributionIn = (target: TextTarget, text: string): boolean => {
  const visible = target === "pr" ? withoutCodeBlocks(text) : text;
  return hasAttribution(visible) || visible.includes(ROBOT);
};

export const textMatches = (rule: ProjectRule, target: TextTarget, text: string): boolean => {
  if (rule.detector?.kind === "attribution") return attributionIn(target, text);
  if (rule.detector?.kind !== "text" || !rule.detector.on.includes(target)) return false;
  const pattern = patternOf(rule.detector.pattern);
  return pattern?.test(target === "pr" ? withoutCodeBlocks(text) : text) === true;
};
