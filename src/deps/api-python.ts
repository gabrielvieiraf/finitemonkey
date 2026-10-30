import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import {
  type ApiRuntime,
  closing,
  type Imported,
  read,
  type Resolved,
  type Signature,
  splitTopLevel,
  type Surface,
} from "./api-parse.js";

const PY_FROM = /^from\s+([A-Za-z_][\w]*)(?:\.[\w.]+)?\s+import\s+\(?([^)\n]+)\)?/gm;
export const pyImports = (source: string): readonly Imported[] =>
  [...source.matchAll(PY_FROM)].flatMap((match) =>
    (match[2] ?? "").split(",").flatMap((item): Imported[] => {
      const [symbol, local] = item.trim().split(/\s+as\s+/);
      if (symbol === undefined || symbol === "" || symbol === "*") return [];
      return [{ pkg: match[1] ?? "", symbol, local: local ?? symbol }];
    }),
  );

const pySignature = (params: string, deprecated: boolean): Signature => {
  const list = splitTopLevel(params).filter((item) => item !== "" && item !== "self" && item !== "cls" && item !== "/");
  const names = list.map((item) => item.replace(/[:=].*$/s, "").trim());
  const varKw = names.some((name) => name.startsWith("**"));
  const star = names.findIndex((name) => name.startsWith("*"));
  const positional = (star < 0 ? list : list.slice(0, star)).filter((item) => !item.startsWith("*"));
  return {
    required: positional.filter((item) => !item.includes("=")).length,
    max:
      star >= 0 && names[star] !== "*" && !varKw
        ? Infinity
        : names.some((name) => /^\*\w/.test(name))
          ? Infinity
          : positional.length,
    keywords: varKw ? undefined : names.filter((name) => !name.startsWith("*")),
    deprecated,
  };
};

export const pySurface = (text: string, version: string): Surface => {
  const exports = new Map<string, Signature>();
  const def = /^((?:@[^\n]+\n)*)(?:async\s+)?def\s+(\w+)\s*\(/gm;
  for (const match of text.matchAll(def)) {
    const open = match.index + match[0].length - 1;
    const end = closing(text, open);
    const body = text.slice(end, !text.includes("\ndef ", end) ? undefined : text.indexOf("\ndef ", end));
    const deprecated =
      /@(?:\w+\.)*deprecated\b/.test(match[1] ?? "") ||
      (body.split(/\n(?=\S)/)[0] ?? "").includes("DeprecationWarning");
    exports.set(match[2] ?? "", pySignature(text.slice(open + 1, end), deprecated));
  }
  for (const match of text.matchAll(/^(?:class\s+(\w+)|(\w+)\s*=)/gm)) {
    const name = match[1] ?? match[2] ?? "";
    if (!exports.has(name)) exports.set(name, { required: 0, max: Infinity, keywords: undefined, deprecated: false });
  }
  for (const match of text.matchAll(/^from\s+\.[\w.]*\s+import\s+\(?([^)\n]+)\)?/gm)) {
    for (const item of (match[1] ?? "").split(",")) {
      const name =
        item
          .trim()
          .split(/\s+as\s+/)
          .pop() ?? "";
      if (name !== "" && name !== "*" && !exports.has(name)) {
        exports.set(name, { required: 0, max: Infinity, keywords: undefined, deprecated: false });
      }
    }
  }
  const dynamic = /^def\s+__getattr__|^from\s+\S+\s+import\s+\*/m.test(text);
  return { version, exports, dynamic };
};

const pyLocked = (runtime: ApiRuntime, root: string, pkg: string): string | undefined => {
  const name = pkg.toLowerCase().replace(/_/g, "-");
  for (const file of ["requirements.txt", "requirements.lock"]) {
    const text = read(runtime, join(root, file));
    const match =
      text === undefined ? null : new RegExp(`^${name}\\s*==\\s*([\\w.]+)`, "im").exec(text.replace(/_/g, "-"));
    if (match?.[1] !== undefined) return match[1];
  }
  for (const file of ["poetry.lock", "uv.lock"]) {
    const text = read(runtime, join(root, file));
    const match =
      text === undefined ? null : new RegExp(`name\\s*=\\s*"${name}"\\s*\\nversion\\s*=\\s*"([^"]+)"`, "i").exec(text);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
};

export const sitePackages = (runtime: ApiRuntime, root: string): string | undefined => {
  for (const venv of [".venv", "venv", "env"]) {
    const lib = join(root, venv, "lib");
    const listed = runtime.listDir(toAbsolutePath(lib));
    const python = listed.ok ? listed.value.find((name) => name.startsWith("python")) : undefined;
    if (python !== undefined) return join(lib, python, "site-packages");
    const windows = join(root, venv, "Lib", "site-packages");
    if (runtime.listDir(toAbsolutePath(windows)).ok) return windows;
  }
  return undefined;
};

export const pySurfaceOf = (runtime: ApiRuntime, root: string, site: string, pkg: string): Resolved => {
  const listed = runtime.listDir(toAbsolutePath(site));
  const dist = listed.ok
    ? listed.value.find(
        (name) =>
          name.toLowerCase().startsWith(`${pkg.toLowerCase().replace(/-/g, "_")}-`) && name.endsWith(".dist-info"),
      )
    : undefined;
  const version = dist?.replace(/\.dist-info$/, "").split("-")[1] ?? "";
  const locked = pyLocked(runtime, root, pkg);
  if (locked !== undefined && locked !== version) {
    return { kind: "unknown", detail: `installed ${version === "" ? "?" : version}, lockfile ${locked}`, version };
  }
  const text = read(runtime, join(site, pkg, "__init__.py")) ?? read(runtime, join(site, `${pkg}.py`));
  return text === undefined
    ? { kind: "unknown", detail: "not installed", version }
    : { kind: "surface", surface: pySurface(text, version) };
};
