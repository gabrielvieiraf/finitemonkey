import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { type AbsolutePath, toAbsolutePath } from "./brand.js";
import { nodeAppendText, nodeExec, nodeSpawnSelf } from "./node-exec.js";
import {
  nodeListDir,
  nodeLock,
  nodeMkdir,
  nodeRemove,
  nodeRename,
  nodeStat,
  nodeWalkFiles,
  nodeWriteAtomic,
  nodeWriteText,
} from "./node-fs.js";
import { nodeGit, nodeGitLines, nodeGitWith } from "./node-git.js";
import { accept, type Parsed, reject } from "./parsed.js";
import type { Probe, Runtime } from "./runtime.js";

const SAFE_TOKEN = /^[A-Za-z0-9._-]+$/;
const WINDOWS_NOT_FOUND = 9009;

const errnoCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
};

const spawnProbe = (command: string, args: readonly string[], timeout: number): SpawnSyncReturns<string> => {
  const options = { encoding: "utf8", timeout, windowsHide: true } as const;
  return process.platform === "win32"
    ? spawnSync([command, ...args].join(" "), { ...options, shell: true })
    : spawnSync(command, [...args], options);
};

export const nodeProbe: Probe = (command, args, timeoutMs) => {
  if (![command, ...args].every((token) => SAFE_TOKEN.test(token))) {
    return { found: false, ok: false, stdout: "", timedOut: false };
  }
  const result = spawnProbe(command, args, timeoutMs);
  const code = errnoCode(result.error);
  const stdout: unknown = result.stdout;
  return {
    found: code !== "ENOENT" && result.status !== WINDOWS_NOT_FOUND,
    ok: result.error === undefined && result.status === 0,
    stdout: typeof stdout === "string" ? stdout.trim() : "",
    timedOut: code === "ETIMEDOUT",
  };
};

export const nodeReadText = (path: AbsolutePath): Parsed<string> => {
  try {
    return accept(readFileSync(path, "utf8"));
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};

export const nodeRealpath = (path: string): string => {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
};

const SELF_PATH = toAbsolutePath(fileURLToPath(import.meta.url));

export const nodeRuntime = (): Runtime => ({
  nodeVersion: process.versions.node,
  readText: nodeReadText,
  probe: nodeProbe,
  startTimer: (ms, onFire) => {
    const timer = setTimeout(onFire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
  writeText: nodeWriteText,
  listDir: nodeListDir,
  walkFiles: nodeWalkFiles,
  now: () => new Date().toISOString(),
  git: nodeGit,
  gitLines: nodeGitLines,
  stat: nodeStat,
  writeAtomic: nodeWriteAtomic,
  rename: nodeRename,
  mkdir: nodeMkdir,
  remove: nodeRemove,
  lock: nodeLock,
  selfPath: SELF_PATH,
  exec: nodeExec,
  appendText: nodeAppendText,
  spawnSelf: nodeSpawnSelf(SELF_PATH),
  execSelf: (args, cwd, timeoutMs) =>
    nodeExec({ command: process.execPath, args: [SELF_PATH, ...args], cwd, timeoutMs }),
  gitWith: nodeGitWith,
  realpath: nodeRealpath,
  homeDir: homedir,
  systemLocale: () => Intl.DateTimeFormat().resolvedOptions().locale,
});
