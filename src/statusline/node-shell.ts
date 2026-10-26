import { type ChildProcess, spawn } from "node:child_process";

import type { AbsolutePath } from "../core/brand.js";

export interface ShellRun {
  readonly text: string | undefined;
  readonly timedOut: boolean;
}

export type Shell = (command: string, input: string, cwd: AbsolutePath, timeoutMs: number) => Promise<ShellRun>;

const killTree = (child: ChildProcess): void => {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).unref();
    } else process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
};

export const nodeShell: Shell = (command, input, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      killTree(child);
      resolve({ text: undefined, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ text: undefined, timedOut: false });
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve({ text: out, timedOut: false });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
