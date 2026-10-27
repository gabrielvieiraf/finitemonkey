import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AbsolutePath } from "./brand.js";
import { accept, type Parsed, reject } from "./parsed.js";
import type { ProcessInfo, StopSignal } from "./runtime.js";

const LSOF_TIMEOUT_MS = 5000;

const linuxProcesses = (): readonly ProcessInfo[] =>
  readdirSync("/proc").flatMap((name) => {
    if (!/^\d+$/.test(name)) return [];
    try {
      return [{ pid: Number(name), cwd: readlinkSync(`/proc/${name}/cwd`) }];
    } catch {
      return [];
    }
  });

export const parseLsofCwd = (stdout: string): readonly ProcessInfo[] => {
  const found: ProcessInfo[] = [];
  let pid: number | undefined;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== undefined && Number.isInteger(pid))
      found.push({ pid, cwd: line.slice(1) });
  }
  return found;
};

const lsofProcesses = (): readonly ProcessInfo[] => {
  try {
    const stdout = execFileSync("lsof", ["-a", "-d", "cwd", "-Fpn"], {
      encoding: "utf8",
      timeout: LSOF_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseLsofCwd(stdout);
  } catch (error) {
    return error instanceof Error && "stdout" in error && typeof error.stdout === "string"
      ? parseLsofCwd(error.stdout)
      : [];
  }
};

export const nodeProcesses = (): readonly ProcessInfo[] => {
  if (process.platform === "linux") return linuxProcesses();
  if (process.platform === "darwin") return lsofProcesses();
  return [];
};

export const nodeSignal = (pid: number, signal: StopSignal): boolean => {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
};

export const nodeAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

const exclusiveIn = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return total + exclusiveIn(full);
    if (!entry.isFile()) return total;
    const stats = lstatSync(full);
    return stats.nlink === 1 ? total + stats.size : total;
  }, 0);

export const nodeExclusiveBytes = (dir: AbsolutePath): number | undefined => {
  try {
    return exclusiveIn(dir);
  } catch {
    return undefined;
  }
};

export const nodeCopyFile = (from: AbsolutePath, to: AbsolutePath): Parsed<undefined> => {
  try {
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    copyFileSync(from, to);
    return accept(undefined);
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};
