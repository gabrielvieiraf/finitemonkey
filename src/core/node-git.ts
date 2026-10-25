import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

import type { Git, GitLines, GitResult } from "./runtime.js";

const MAX_BUFFER = 256 * 1024 * 1024;
const GIT_ENV = { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

const notFound = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";

export const nodeGit: Git = (args, cwd) => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    env: GIT_ENV,
  });
  const stdout: unknown = result.stdout;
  return {
    found: !notFound(result.error),
    ok: result.error === undefined && result.status === 0,
    stdout: typeof stdout === "string" ? stdout : "",
  };
};

export const nodeGitLines: GitLines = (args, cwd, onLine) =>
  new Promise<GitResult>((resolve) => {
    const child = spawn("git", [...args], {
      cwd,
      windowsHide: true,
      env: GIT_ENV,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let found = true;
    child.on("error", (error) => {
      found = !notFound(error);
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", onLine);
    child.on("close", (code) => {
      resolve({ found, ok: found && code === 0, stdout: "" });
    });
  });
