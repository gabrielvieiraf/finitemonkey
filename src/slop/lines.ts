import type { Declared } from "./ast.js";
import type { SlopConfig } from "./config.js";
import { nameDetector } from "./names.js";
import { finding, type SlopFinding } from "./types.js";

export interface AddedLine {
  readonly line: number;
  readonly text: string;
}

export interface SplitLine {
  readonly code: string;
  readonly comment: string;
}

const extensionOf = (file: string): string => file.split(".").pop()?.toLowerCase() ?? "";

const HASH_COMMENT = new Set(["py", "rb", "sh", "bash", "zsh", "yml", "yaml", "toml", "pl", "r"]);
const UI_MARKUP = new Set(["tsx", "jsx", "vue", "svelte", "html", "astro"]);
const SCRIPT = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);
const TYPED = new Set(["ts", "tsx", "mts", "cts"]);
const CODE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|cs|php|swift|c|cc|cpp|h|hpp|vue|svelte|sh)$/i;
const TEST = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(py|go)$|(^|\/)test_[^/]+\.py$/;
const DEBUG_EXEMPT = /(^|\/)(scripts?|bin|examples?|tools)\//;

export const isSlopCode = (file: string): boolean => CODE.test(file);

export const splitLine = (raw: string, file: string): SplitLine => {
  const hash = HASH_COMMENT.has(extensionOf(file));
  const trimmed = raw.trimStart();
  if (!hash && (trimmed.startsWith("*") || trimmed.startsWith("/*"))) return { code: "", comment: trimmed };
  let code = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    const rest = raw.slice(index);
    if (hash ? char === "#" : rest.startsWith("//") || rest.startsWith("/*")) return { code, comment: rest };
    if (char !== '"' && char !== "'" && char !== "`") {
      code += char;
      continue;
    }
    let end = index + 1;
    while (end < raw.length && raw.charAt(end) !== char) end += raw.charAt(end) === "\\" ? 2 : 1;
    code += `${char}${char}`;
    index = end;
  }
  return { code, comment: "" };
};

const NARRATION =
  /^(?:[/#*\s-]*)(?:note:\s*)?(?:(?:now|changed|updated|modified|replaced|refactored|fixed|added|removed|moved|renamed|switched|converted|rewrote|rewritten|previously|formerly|originally)\b|(?:new|update|fix|change|changes)\s*:)|\b(?:instead of the old|no longer|used to be|was changed|has been (?:changed|updated|replaced|removed|added|fixed|refactored))\b/i;
const DIRECTIVE =
  /^[/#*\s]*(?:@ts-|eslint|prettier|istanbul|c8|type:|noqa|pylint|#!|TODO|FIXME|SPDX|Copyright|region|endregion)/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const ANY = /(?::|<|\|)\s*any\b(?![\w$])|\bas\s+any\b|\bany\[\]|\bas\s+unknown\s+as\b/;
const TS_IGNORE = /@ts-(?:ignore|nocheck)\b/;
const DEBUG_JS = /\bconsole\s*\.\s*(?:log|debug|trace|dir|table)\s*\(|^\s*debugger\b/;
const DEBUG_PY = /^\s*(?:print\s*\(|breakpoint\s*\(|import\s+pdb\b|pdb\.set_trace\s*\()/;
const FALLBACK_JS = /(?:\?\?|\|\|)\s*(?:""|''|``|0|\[\]|\{\}|null|undefined|false|-1)\s*(?=[;,)\]}]|$)/;
const FALLBACK_PY = /\bor\s+(?:""|''|0|\[\]|\{\}|None)\s*(?=[,)\]}]|$)/;
const DECLARED =
  /(?:\b(?:function\*?|class|interface|type|enum|def|func|fn|struct|trait)\s+|\b(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/g;

const hasReason = (config: SlopConfig, text: string, previous: string | undefined): boolean =>
  config.reason.test(text) || (previous !== undefined && config.reason.test(previous));

const commentFindings = (file: string, added: AddedLine, split: SplitLine): readonly SlopFinding[] => {
  if (split.comment === "" || DIRECTIVE.test(split.comment)) return [];
  return NARRATION.test(split.comment) ? [finding("narrating_comment", file, added.line, added.text)] : [];
};

const regexNames = (code: string): readonly string[] => [...code.matchAll(DECLARED)].map((match) => match[1] ?? "");

const nameFindings = (
  file: string,
  added: AddedLine,
  names: readonly string[],
  config: SlopConfig,
): readonly SlopFinding[] =>
  names.flatMap((name) => {
    const detector = config.names.has(name) ? undefined : nameDetector(name);
    return detector === undefined ? [] : [finding(detector, file, added.line, added.text, name)];
  });

const scriptFindings = (file: string, added: AddedLine, split: SplitLine): readonly SlopFinding[] => {
  const ext = extensionOf(file);
  const debugChecked = !TEST.test(file) && !DEBUG_EXEMPT.test(file);
  const script = SCRIPT.has(ext);
  return [
    ...(debugChecked && ((script && DEBUG_JS.test(split.code)) || (ext === "py" && DEBUG_PY.test(split.code)))
      ? [finding("debug_output", file, added.line, added.text)]
      : []),
    ...((script && FALLBACK_JS.test(split.code)) || (ext === "py" && FALLBACK_PY.test(split.code))
      ? [finding("literal_fallback", file, added.line, added.text)]
      : []),
  ];
};

const typedFindings = (
  file: string,
  added: AddedLine,
  split: SplitLine,
  config: SlopConfig,
  previous: string | undefined,
): readonly SlopFinding[] => {
  if (!TYPED.has(extensionOf(file)) || hasReason(config, added.text, previous)) return [];
  return ANY.test(split.code) || TS_IGNORE.test(split.comment)
    ? [finding("unchecked_any", file, added.line, added.text)]
    : [];
};

export const lineFindings = (
  file: string,
  added: readonly AddedLine[],
  config: SlopConfig,
  previous: (line: number) => string | undefined,
  declared?: readonly Declared[],
): readonly SlopFinding[] => {
  if (!isSlopCode(file)) return [];
  const namesAt = (line: number, code: string): readonly string[] =>
    declared === undefined ? regexNames(code) : declared.filter((item) => item.line === line).map((item) => item.name);
  const markup = UI_MARKUP.has(extensionOf(file));
  return added.flatMap((item) => {
    const split = splitLine(item.text, file);
    const emojiIn = markup ? split.comment : `${split.code}${split.comment}`;
    return [
      ...commentFindings(file, item, split),
      ...(EMOJI.test(emojiIn) ? [finding("emoji", file, item.line, item.text)] : []),
      ...nameFindings(file, item, namesAt(item.line, split.code), config),
      ...scriptFindings(file, item, split),
      ...typedFindings(file, item, split, config, previous(item.line - 1)),
    ];
  });
};
