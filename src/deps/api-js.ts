import { join } from "node:path";

import { isRecord, type JsonObject } from "../core/parsed.js";
import {
  ANY_SIGNATURE,
  type ApiRuntime,
  closing,
  jsSignature,
  read,
  type Signature,
  splitTopLevel,
  type Surface,
} from "./api-parse.js";

const ENTRY_CONDITIONS = ["require", "node", "import", "default"] as const;
const DYNAMIC_SOURCE =
  /export\s*\*\s*from|__exportStar\(|Object\.assign\(\s*(?:module\.)?exports|module\.exports\s*=\s*require\(|__export\(/;
const FUNCTION_HEAD = /^(?:async\s+)?function\s*\*?\s*[\w$]*\s*\(/;
const ARROW_HEAD = /^(?:async\s+)?\(/;
const SINGLE_ARROW = /^(?:async\s+)?[\w$]+\s*=>/;

const conditionEntry = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  for (const key of ENTRY_CONDITIONS) {
    const found = conditionEntry(value[key]);
    if (found !== undefined) return found;
  }
  return undefined;
};

export const jsEntries = (manifest: JsonObject): readonly string[] => {
  const exported = manifest["exports"];
  const dot = isRecord(exported) && "." in exported ? exported["."] : exported;
  const named = [conditionEntry(dot), manifest["main"], manifest["module"]].filter(
    (item): item is string => typeof item === "string" && item !== "",
  );
  return [...named, "index.js"].flatMap((entry) => [entry, `${entry}.js`, join(entry, "index.js")]);
};

export const jsSourceOf = (runtime: ApiRuntime, dir: string, manifest: JsonObject): string | undefined =>
  jsEntries(manifest)
    .map((entry) => read(runtime, join(dir, entry)))
    .find((text) => text !== undefined);

const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const valueSignature = (text: string, at: number, before: string): Signature | undefined => {
  const rest = text.slice(at).trimStart();
  const start = text.length - rest.length;
  if (SINGLE_ARROW.test(rest)) return { required: 1, max: 1, keywords: undefined, deprecated: false };
  const declared = FUNCTION_HEAD.exec(rest);
  const head = declared ?? ARROW_HEAD.exec(rest);
  if (head === null) return undefined;
  const open = start + head[0].length - 1;
  const end = closing(text, open);
  if (end < 0) return undefined;
  if (declared === null && !/^\s*=>/.test(text.slice(end + 1))) return undefined;
  return jsSignature(text.slice(open + 1, end), before);
};

const localSignature = (text: string, name: string): Signature | undefined => {
  const escaped = name.replace(/\$/g, "\\$");
  const declared = new RegExp(`(?:^|[\\s;])(?:async\\s+)?function\\s*\\*?\\s*${escaped}\\s*\\(`, "m").exec(text);
  if (declared !== null) {
    const open = declared.index + declared[0].length - 1;
    return jsSignature(text.slice(open + 1, closing(text, open)), text.slice(0, declared.index));
  }
  const bound = new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=`).exec(text);
  return bound === null ? undefined : valueSignature(text, bound.index + bound[0].length, "");
};

const resolveValue = (text: string, raw: string, at: number): Signature => {
  const value = raw.trim();
  if (/^[\w$]+$/.test(value)) return localSignature(text, value) ?? ANY_SIGNATURE;
  return valueSignature(text, at, "") ?? ANY_SIGNATURE;
};

const objectEntries = (text: string, body: string, add: (name: string, signature: Signature) => void): void => {
  for (const item of splitTopLevel(body)) {
    const method = /^(?:async\s+)?([\w$]+)\s*\(/.exec(item);
    const pair = /^([\w$]+)\s*:\s*([\s\S]*)$/.exec(item);
    if (pair !== null) {
      const value = (pair[2] ?? "").trim();
      add(
        pair[1] ?? "",
        /^[\w$]+$/.test(value)
          ? (localSignature(text, value) ?? ANY_SIGNATURE)
          : (valueSignature(value, 0, "") ?? ANY_SIGNATURE),
      );
    } else if (method !== null) {
      const open = method[0].length - 1;
      add(method[1] ?? "", jsSignature(item.slice(open + 1, closing(item, open)), ""));
    } else if (/^[\w$]+$/.test(item)) add(item, localSignature(text, item) ?? ANY_SIGNATURE);
  }
};

const esmExports = (text: string, add: (name: string, signature: Signature) => void): void => {
  for (const match of text.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    add(match[1] ?? "", jsSignature(text.slice(open + 1, closing(text, open)), text.slice(0, match.index)));
  }
  for (const match of text.matchAll(/export\s+(?:const|let|var)\s+([\w$]+)\s*=/g))
    add(match[1] ?? "", valueSignature(text, match.index + match[0].length, "") ?? ANY_SIGNATURE);
  for (const match of text.matchAll(/export\s+class\s+([\w$]+)/g)) add(match[1] ?? "", ANY_SIGNATURE);
  for (const match of text.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const item of (match[1] ?? "").split(",")) {
      const [local = "", name = local] = item.trim().split(/\s+as\s+/);
      if (name !== "" && name !== "default") add(name, localSignature(text, local) ?? ANY_SIGNATURE);
    }
  }
};

const cjsExports = (text: string, add: (name: string, signature: Signature) => void): void => {
  for (const match of text.matchAll(/(?<![\w$.])(?:module\.)?exports\.([\w$]+)\s*=(?!=)\s*([^;\n]*)/g)) {
    const at = match.index + match[0].length - (match[2] ?? "").length;
    add(match[1] ?? "", resolveValue(text, match[2] ?? "", at));
  }
  for (const match of text.matchAll(/Object\.defineProperty\(\s*exports\s*,\s*["']([\w$]+)["']/g)) {
    if (match[1] !== "__esModule") add(match[1] ?? "", ANY_SIGNATURE);
  }
  for (const match of text.matchAll(/module\.exports\s*=\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < text.length; end += 1) {
      if (text.charAt(end) === "{") depth += 1;
      if (text.charAt(end) === "}") depth -= 1;
      if (depth === 0) break;
    }
    objectEntries(text, text.slice(open + 1, end), add);
  }
};

export const jsSourceSurface = (source: string, version: string): Surface => {
  const text = withoutComments(source);
  const exports = new Map<string, Signature>();
  const add = (name: string, signature: Signature): void => {
    const known = exports.get(name);
    if (name !== "" && (known === undefined || known === ANY_SIGNATURE)) exports.set(name, signature);
  };
  esmExports(text, add);
  cjsExports(text, add);
  const whole = /module\.exports\s*=\s*(?!\{|require\()[\w$(]/.test(text);
  return { version, exports, dynamic: exports.size === 0 || whole || DYNAMIC_SOURCE.test(text) };
};
