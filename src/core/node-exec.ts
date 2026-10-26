import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { AbsolutePath } from "./brand.js";
import { accept, type Parsed, reject } from "./parsed.js";
import type { Exec } from "./runtime.js";

const SHELL_NOT_FOUND = new Set([127, 9009]);
const CMD_NOT_FOUND =
  /is not recognized as an internal or external command|não é reconhecido como um comando interno|no se reconoce como un comando interno/i;
const MAX_BUFFER = 64 * 1024 * 1024;

const errnoCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export const nodeExec: Exec = (request) => {
  const started = Date.now();
  const options = {
    cwd: request.cwd,
    encoding: "utf8",
    timeout: request.timeoutMs,
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
    ...(request.input === undefined ? {} : { input: request.input }),
    env: Object.fromEntries(
      Object.entries({ ...process.env, ...request.env }).filter(([name]) => !(request.unset ?? []).includes(name)),
    ),
  } as const;
  const result =
    request.shell === true
      ? spawnSync([request.command, ...request.args].join(" "), { ...options, shell: true })
      : spawnSync(request.command, [...request.args], options);
  const code = errnoCode(result.error);
  const exitCode = result.status;
  const shellMissing =
    request.shell === true &&
    exitCode !== null &&
    (SHELL_NOT_FOUND.has(exitCode) || (exitCode === 1 && CMD_NOT_FOUND.test(text(result.stderr))));
  const notFound = code === "ENOENT" || shellMissing;
  return {
    found: !notFound,
    exitCode,
    stdout: text(result.stdout),
    stderr: text(result.stderr),
    timedOut: code === "ETIMEDOUT",
    durationMs: Date.now() - started,
  };
};

export const nodeAppendText = (path: AbsolutePath, content: string): Parsed<true> => {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, content, { mode: 0o600 });
    return accept(true);
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};

export const nodeSpawnSelf =
  (selfPath: AbsolutePath) =>
  (args: readonly string[], cwd: AbsolutePath): boolean => {
    try {
      const child = spawn(process.execPath, [selfPath, ...args], {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", () => undefined);
      child.unref();
      return true;
    } catch {
      return false;
    }
  };
