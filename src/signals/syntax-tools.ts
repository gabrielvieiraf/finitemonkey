import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { lineAt, oneLine, type Parse, stripper, type SyntaxProblem, type SyntaxTools } from "./syntax.js";

export const MODULE_CHECK_MS = 5_000;
const ERROR_CATEGORY = 1;

export const nodeModuleCheck =
  (runtime: Pick<Runtime, "exec">, cwd: AbsolutePath): Parse =>
  (_file, text) => {
    const result = runtime.exec({
      command: process.execPath,
      args: ["--input-type=module", "--check"],
      cwd,
      timeoutMs: MODULE_CHECK_MS,
      input: text,
    });
    if (!result.found || result.timedOut || result.exitCode === 0) return undefined;
    const message = /^SyntaxError: (.*)$/m.exec(result.stderr)?.[1];
    if (message === undefined) return undefined;
    const line = /^\[stdin\]:(\d+)/m.exec(result.stderr)?.[1];
    return { line: line === undefined ? 0 : Number(line), message: oneLine(message) };
  };

const messageOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  return isRecord(value) ? messageOf(value["messageText"]) : "";
};

const firstError = (text: string, diagnostics: unknown): SyntaxProblem | undefined => {
  if (!Array.isArray(diagnostics)) return undefined;
  const found: unknown = diagnostics.find((item: unknown) => isRecord(item) && item["category"] === ERROR_CATEGORY);
  if (!isRecord(found)) return undefined;
  const start = found["start"];
  return {
    line: typeof start === "number" ? lineAt(text, start) : 0,
    message: oneLine(messageOf(found["messageText"])),
  };
};

const loadTypescript = (root: string): Readonly<Record<string, unknown>> | undefined => {
  try {
    const loaded: unknown = createRequire(join(root, "package.json"))("typescript");
    return isRecord(loaded) ? loaded : undefined;
  } catch {
    return undefined;
  }
};

export const projectTypescript =
  (root: string): Parse =>
  (file, text) => {
    const ts = loadTypescript(root);
    const transpile = ts?.["transpileModule"];
    if (typeof transpile !== "function") return undefined;
    try {
      const out: unknown = Reflect.apply(transpile, ts, [text, { fileName: file, reportDiagnostics: true }]);
      return isRecord(out) ? firstError(text, out["diagnostics"]) : undefined;
    } catch {
      return undefined;
    }
  };

const declaresModule = (runtime: Pick<Runtime, "readText">, dir: string): boolean | undefined => {
  const text = runtime.readText(toAbsolutePath(join(dir, "package.json")));
  if (!text.ok) return undefined;
  const parsed = parseJsonObject(text.value);
  return parsed.ok && parsed.value["type"] === "module";
};

export const packageIsModule = (runtime: Pick<Runtime, "readText">, root: string, file: string): boolean => {
  let dir = dirname(join(root, file));
  while (!relative(root, dir).startsWith("..")) {
    const found = declaresModule(runtime, dir);
    if (found !== undefined) return found;
    if (dir === root) break;
    dir = dirname(dir);
  }
  return false;
};

export const projectSyntaxTools = (
  runtime: Pick<Runtime, "exec" | "readText">,
  root: string,
  file: string,
): SyntaxTools => {
  const strip = stripper();
  return {
    strip,
    ...(strip === undefined ? { typescript: projectTypescript(root) } : {}),
    module: nodeModuleCheck(runtime, toAbsolutePath(root)),
    esm: packageIsModule(runtime, root, file),
  };
};
