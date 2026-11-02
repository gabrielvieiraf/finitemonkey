import { toPosixPath } from "../core/posix-path.js";
import { isPlaceholder, isTestOrLockPath } from "./allowlist.js";

export interface ContextFinding {
  readonly name: string;
  readonly line: number;
}

export const SECRET_CONTEXT_FEATURE = "secret-context";

const NAMES = String.raw`(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)`;
const ASSIGNMENT = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?<name>[A-Za-z0-9_.-]*?${NAMES})["']?[ \t]*(?:=|:=|:|=>)[ \t]*(?<quote>["'\x60]?)(?<value>[^\s"'\x60,;()[\]{}<>]{4,128})\k<quote>(?=[\s,;)\]}]|$)`,
  "gim",
);

const CONFIG_FILE =
  /(?:^|\/)\.env(?:\.[\w-]+)?$|\.(?:env|ya?ml|toml|ini|cfg|conf|properties|json|tfvars|npmrc|netrc)$/i;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|rb|go|java|kt|kts|php|cs|rs|sh|bash|zsh|swift|scala|ex|exs)$/i;
const EXAMPLE_FILE = /\.(?:example|sample|template|dist|tmpl)$/i;
const NOT_SECRET = /^(?:true|false|null|none|nil|undefined|yes|no|on|off|\d+(?:\.\d+)?)$/i;

type FileKind = "config" | "code" | "other";

const kindOf = (path: string): FileKind => {
  if (EXAMPLE_FILE.test(path) || isTestOrLockPath(path)) return "other";
  if (CONFIG_FILE.test(path)) return "config";
  return CODE_FILE.test(path) ? "code" : "other";
};

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const reported = (kind: FileKind, quote: string, value: string): boolean => {
  if (kind === "code" && quote === "") return false;
  return !NOT_SECRET.test(value) && !isPlaceholder(value);
};

export const contextFindings = (path: string, text: string): readonly ContextFinding[] => {
  const kind = kindOf(toPosixPath(path));
  if (kind === "other") return [];
  return [...text.matchAll(ASSIGNMENT)].flatMap((match) => {
    const { name = "", quote = "", value = "" } = match.groups ?? {};
    return reported(kind, quote, value) ? [{ name, line: lineOf(text, match.index) }] : [];
  });
};
