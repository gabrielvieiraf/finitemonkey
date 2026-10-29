import { join } from "node:path";

import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import {
  type ApiFinding,
  type ApiFindingKind,
  type ApiRuntime,
  callsOf,
  closing,
  type Imported,
  read,
  type Resolved,
  type Signature,
  splitTopLevel,
  type Surface,
} from "./api-parse.js";
import { pyImports, pySurfaceOf, sitePackages } from "./api-python.js";

export type { ApiFinding } from "./api-parse.js";

const JS_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']([^"'./][^"']*)["']/g;
const JS_REQUIRE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["']([^"'./][^"']*)["']\s*\)/g;
const packageName = (spec: string): string => {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec);
};

export const jsImports = (source: string): readonly Imported[] =>
  [...source.matchAll(JS_IMPORT), ...source.matchAll(JS_REQUIRE)].flatMap((match) =>
    (match[1] ?? "").split(",").flatMap((item): Imported[] => {
      const [symbol, local] = item
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+|\s*:\s*/);
      if (symbol === undefined || symbol === "") return [];
      return [{ pkg: packageName(match[2] ?? ""), symbol, local: local ?? symbol }];
    }),
  );

const DEPRECATED_DOC = /\/\*\*(?:(?!\*\/)[\s\S])*@deprecated(?:(?!\*\/)[\s\S])*\*\/\s*$/;

const jsSignature = (params: string, before: string): Signature => {
  const list = splitTopLevel(params).filter((item) => !/^this\s*:/.test(item));
  const rest = list.some((item) => item.startsWith("..."));
  const required = list.filter((item) => !item.startsWith("...") && !/^\w+\?|=/.test(item)).length;
  return { required, max: rest ? Infinity : list.length, keywords: undefined, deprecated: DEPRECATED_DOC.test(before) };
};

export const dtsSurface = (text: string, version: string): Surface => {
  const exports = new Map<string, Signature>();
  const fn = /export\s+(?:declare\s+)?function\s+([\w$]+)\s*(?:<[^>]*>)?\s*\(/g;
  for (const match of text.matchAll(fn)) {
    const open = match.index + match[0].length - 1;
    const signature = jsSignature(text.slice(open + 1, closing(text, open)), text.slice(0, match.index));
    const name = match[1] ?? "";
    const known = exports.get(name);
    exports.set(
      name,
      known === undefined
        ? signature
        : {
            ...known,
            required: Math.min(known.required, signature.required),
            max: Math.max(known.max, signature.max),
            deprecated: known.deprecated && signature.deprecated,
          },
    );
  }
  const value = /export\s+(?:declare\s+)?(?:const|let|var|class|enum|type|interface|namespace)\s+([\w$]+)/g;
  for (const match of text.matchAll(value)) {
    const name = match[1] ?? "";
    if (!exports.has(name)) {
      exports.set(name, {
        required: 0,
        max: Infinity,
        keywords: undefined,
        deprecated: DEPRECATED_DOC.test(text.slice(0, match.index)),
      });
    }
  }
  for (const match of text.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const item of (match[1] ?? "").split(",")) {
      const name =
        item
          .trim()
          .split(/\s+as\s+/)
          .pop() ?? "";
      if (name !== "" && !exports.has(name))
        exports.set(name, { required: 0, max: Infinity, keywords: undefined, deprecated: false });
    }
  }
  const dynamic = /export\s*=|export\s*\*\s*from|export\s*\{[^}]*\}\s*from|\[\s*\w+\s*:\s*string\s*\]/.test(text);
  return { version, exports, dynamic };
};

const lockedNpm = (runtime: ApiRuntime, root: string, pkg: string): string | undefined => {
  const text = read(runtime, join(root, "package-lock.json"));
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  const packages = parsed?.ok === true ? parsed.value["packages"] : undefined;
  const entry = isRecord(packages) ? packages[`node_modules/${pkg}`] : undefined;
  return isRecord(entry) && typeof entry["version"] === "string" ? entry["version"] : undefined;
};

export const npmSurface = (runtime: ApiRuntime, root: string, pkg: string): Resolved => {
  const dir = join(root, "node_modules", pkg);
  const manifest = parseJsonObject(read(runtime, join(dir, "package.json")) ?? "");
  if (!manifest.ok) return { kind: "unknown", detail: "not installed", version: "" };
  const version = typeof manifest.value["version"] === "string" ? manifest.value["version"] : "";
  const locked = lockedNpm(runtime, root, pkg);
  if (locked !== undefined && locked !== version) {
    return { kind: "unknown", detail: `installed ${version}, lockfile ${locked}`, version };
  }
  const typesField = manifest.value["types"] ?? manifest.value["typings"];
  const candidates = [
    ...(typeof typesField === "string" ? [join(dir, typesField)] : []),
    join(dir, "index.d.ts"),
    join(root, "node_modules", "@types", pkg.replace(/^@([^/]+)\//, "$1__"), "index.d.ts"),
  ];
  const text = candidates.map((path) => read(runtime, path)).find((item) => item !== undefined);
  return text === undefined
    ? { kind: "unknown", detail: "no type declarations", version }
    : { kind: "surface", surface: dtsSurface(text, version) };
};

export const checkCalls = (
  file: string,
  source: string,
  imported: Imported,
  resolved: Resolved,
): readonly ApiFinding[] => {
  const base = { file, pkg: imported.pkg, symbol: imported.symbol };
  if (resolved.kind === "unknown") {
    const kind = resolved.detail.startsWith("installed") ? "not_verified" : "uncertain";
    return [{ ...base, kind, version: resolved.version, detail: resolved.detail }];
  }
  const { surface } = resolved;
  const signature = surface.exports.get(imported.symbol);
  const finding = (kind: ApiFindingKind, detail = ""): ApiFinding => ({
    ...base,
    kind,
    version: surface.version,
    detail,
  });
  if (signature === undefined) return [finding(surface.dynamic ? "uncertain" : "missing")];
  const findings: ApiFinding[] = signature.deprecated ? [finding("deprecated")] : [];
  for (const call of callsOf(source, imported.local)) {
    const unknown = call.keywords.filter(
      (name) => signature.keywords !== undefined && !signature.keywords.includes(name),
    );
    if (unknown.length > 0) findings.push(finding("keyword", unknown.join(", ")));
    if (call.positional > signature.max)
      findings.push(finding("arity", `${String(call.positional)} > ${String(signature.max)}`));
  }
  return findings;
};

export const UNTYPED_JS = /\.(?:js|mjs|cjs|jsx)$/;
export const PYTHON = /\.py$/;

export const apiFindings = (
  runtime: ApiRuntime,
  root: AbsolutePath,
  files: readonly { readonly path: string; readonly text: string }[],
): readonly ApiFinding[] => {
  const site = files.some((file) => file.path.endsWith(".py")) ? sitePackages(runtime, root) : undefined;
  return files.flatMap((file) => {
    if (UNTYPED_JS.test(file.path)) {
      return jsImports(file.text).flatMap((item) =>
        checkCalls(file.path, file.text, item, npmSurface(runtime, root, item.pkg)),
      );
    }
    if (!file.path.endsWith(".py")) return [];
    return pyImports(file.text).flatMap((item) =>
      checkCalls(
        file.path,
        file.text,
        item,
        site === undefined
          ? { kind: "unknown", detail: "no virtual environment", version: "" }
          : pySurfaceOf(runtime, root, site, item.pkg),
      ),
    );
  });
};
