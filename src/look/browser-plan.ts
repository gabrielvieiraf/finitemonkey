import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import { engineInstaller } from "./engine.js";

export const BROWSER_NAME = "chromium";
export const BROWSER_SIZE_MB = 180;
export const BROWSER_TIMEOUT_MS = 600_000;

const RUNNER: Readonly<Record<string, readonly string[]>> = {
  npm: ["npx", "--yes", "playwright"],
  pnpm: ["pnpm", "exec", "playwright"],
  yarn: ["yarn", "playwright"],
  bun: ["bunx", "playwright"],
};

export interface BrowserPlan {
  readonly browser: string;
  readonly sizeMb: number;
  readonly present: boolean;
  readonly command: string;
  readonly added: boolean;
}

type Files = Pick<Runtime, "readText" | "stat" | "listDir" | "homeDir">;

export const browserDirs = (runtime: Pick<Runtime, "homeDir">, env: Env): readonly string[] => {
  const declared = env["PLAYWRIGHT_BROWSERS_PATH"];
  if (declared !== undefined && declared !== "" && declared !== "0") return [declared];
  const local = env["LOCALAPPDATA"];
  return [
    join(runtime.homeDir(), ".cache", "ms-playwright"),
    join(runtime.homeDir(), "Library", "Caches", "ms-playwright"),
    ...(local === undefined || local === "" ? [] : [join(local, "ms-playwright")]),
  ];
};

export const hasBrowser = (runtime: Files, env: Env): boolean =>
  browserDirs(runtime, env).some((dir) => {
    const entries = runtime.listDir(toAbsolutePath(dir));
    return entries.ok && entries.value.some((entry) => entry.startsWith(BROWSER_NAME));
  });

export const browserCommand = (runtime: Files, root: AbsolutePath): readonly string[] => {
  const [manager] = engineInstaller(runtime, root);
  return [...(RUNNER[manager] ?? RUNNER["npm"] ?? []), "install", BROWSER_NAME];
};

export const browserPlan = (
  runtime: Files & Pick<Runtime, "exec">,
  root: AbsolutePath,
  env: Env,
  confirmed: boolean,
): BrowserPlan => {
  const present = hasBrowser(runtime, env);
  const [command = "npx", ...args] = browserCommand(runtime, root);
  const base = {
    browser: BROWSER_NAME,
    sizeMb: BROWSER_SIZE_MB,
    present,
    command: [command, ...args].join(" "),
    added: false,
  };
  if (present || !confirmed) return base;
  const result = runtime.exec({ command, args, cwd: root, timeoutMs: BROWSER_TIMEOUT_MS });
  return { ...base, added: result.found && result.exitCode === 0 };
};
