import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Formatter } from "./files.js";

const FORMAT_TIMEOUT_MS = 20_000;
const PRETTIER_DIR = ["node_modules", "prettier"] as const;
const FORMATTED = /\.(?:[cm]?[jt]sx?|json|ya?ml|md)$/;

export type FormatRuntime = Pick<Runtime, "readText" | "exec">;

export const prettierBin = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): AbsolutePath | undefined => {
  const manifest = runtime.readText(toAbsolutePath(join(root, ...PRETTIER_DIR, "package.json")));
  const parsed = manifest.ok ? parseJsonObject(manifest.value) : undefined;
  if (parsed?.ok !== true) return undefined;
  const bin = parsed.value["bin"];
  const relative = typeof bin === "string" ? bin : isRecord(bin) ? bin["prettier"] : undefined;
  return typeof relative === "string" ? toAbsolutePath(join(root, ...PRETTIER_DIR, relative)) : undefined;
};

export const projectFormatter = (runtime: FormatRuntime, root: AbsolutePath): Formatter => {
  const bin = prettierBin(runtime, root);
  if (bin === undefined) return (_path, text) => text;
  return (path, text) => {
    if (!FORMATTED.test(path)) return text;
    const result = runtime.exec({
      command: "node",
      args: [bin, "--stdin-filepath", path],
      cwd: root,
      timeoutMs: FORMAT_TIMEOUT_MS,
      input: text,
    });
    return result.exitCode === 0 && result.stdout !== "" ? result.stdout : text;
  };
};
