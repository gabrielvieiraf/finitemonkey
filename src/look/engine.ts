import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { packageManager } from "../task/implicit.js";
import { LOOK_CONFIG } from "./config.js";

export const ENGINE_PACKAGE = "axe-core";
export const ENGINE_SIZE_MB = 3;
export const ENGINE_TIMEOUT_MS = 180_000;

const ADD_ARGS: Readonly<Record<string, readonly string[]>> = {
  npm: ["install", "--save-dev", ENGINE_PACKAGE],
  pnpm: ["add", "--save-dev", ENGINE_PACKAGE],
  yarn: ["add", "--dev", ENGINE_PACKAGE],
  bun: ["add", "--dev", ENGINE_PACKAGE],
};

export interface EnginePlan {
  readonly package: string;
  readonly sizeMb: number;
  readonly present: boolean;
  readonly command: string;
  readonly added: boolean;
}

type Files = Pick<Runtime, "readText" | "stat">;

const at = (root: AbsolutePath, file: string): AbsolutePath => toAbsolutePath(join(root, file));

const declared = (runtime: Files, root: AbsolutePath): boolean => {
  const text = runtime.readText(at(root, "package.json"));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (!parsed?.ok) return false;
  return ["dependencies", "devDependencies", "optionalDependencies"].some((field) => {
    const group = parsed.value[field];
    return isRecord(group) && typeof group[ENGINE_PACKAGE] === "string";
  });
};

export const hasEngine = (runtime: Files, root: AbsolutePath): boolean =>
  declared(runtime, root) || runtime.stat(at(root, join("node_modules", ENGINE_PACKAGE, "axe.min.js"))) !== undefined;

export const wantsLook = (runtime: Files, root: AbsolutePath): boolean => runtime.readText(at(root, LOOK_CONFIG)).ok;

export const engineInstaller = (runtime: Files, root: AbsolutePath): readonly [string, readonly string[]] => {
  const manager = packageManager({
    read: () => undefined,
    exists: (file) => runtime.stat(at(root, file)) !== undefined,
  });
  return [manager, ADD_ARGS[manager] ?? ADD_ARGS["npm"] ?? []];
};

export const enginePlan = (
  runtime: Files & Pick<Runtime, "exec">,
  root: AbsolutePath,
  confirmed: boolean,
): EnginePlan => {
  const present = hasEngine(runtime, root);
  const [manager, args] = engineInstaller(runtime, root);
  const command = [manager, ...args].join(" ");
  const base = { package: ENGINE_PACKAGE, sizeMb: ENGINE_SIZE_MB, present, command, added: false };
  if (present || !confirmed) return base;
  const result = runtime.exec({ command: manager, args, cwd: root, timeoutMs: ENGINE_TIMEOUT_MS });
  return { ...base, added: result.found && result.exitCode === 0 };
};
