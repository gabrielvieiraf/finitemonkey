import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { parseJsonObject } from "../src/core/parsed.js";
import type { Arm } from "./bench-arms.js";
import type { HarnessDeps, RunOutcome } from "./bench-harness.js";
import type { Invocation, PinnedPlugin } from "./bench-invoke.js";

const RUN_TIMEOUT_MS = 45 * 60 * 1000;

export const claudeVersion = (): string => {
  const result = spawnSync("claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error("claude --version failed; is Claude Code installed?");
  return result.stdout.trim();
};

export const insideRepo = (dir: string): boolean =>
  spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" }).status === 0;

export const tempRoot = (): string => realpathSync.native(mkdtempSync(join(tmpdir(), "fm-bench-")));

export const pinnedPlugin =
  (repo: string, cacheDir: string) =>
  (arm: Arm): PinnedPlugin | undefined => {
    if (!arm.finitemonkey || arm.sha === undefined) return undefined;
    const checkout = join(cacheDir, arm.sha);
    if (!existsSync(checkout)) {
      mkdirSync(cacheDir, { recursive: true });
      const added = spawnSync("git", ["-C", repo, "worktree", "add", "--detach", checkout, arm.sha], {
        encoding: "utf8",
      });
      if (added.status !== 0) throw new Error(`cannot check out ${arm.sha}: ${added.stderr}`);
    }
    const root = join(checkout, "plugin");
    const hooks = parseJsonObject(readFileSync(join(root, "hooks", "hooks.json"), "utf8"));
    if (!hooks.ok) throw new Error(`${arm.sha}: plugin/hooks/hooks.json is not valid JSON`);
    return { root, hooks: hooks.value };
  };

export const spawnClaude = (invocation: Invocation): Promise<RunOutcome> =>
  new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(invocation.command, [...invocation.args], {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const limit = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(limit);
      resolve({ exitCode, durationMs: Math.round(performance.now() - start), stdout, stderr });
    });
  });

export const realDeps = (repo: string, cacheDir: string): HarnessDeps => ({
  runner: spawnClaude,
  claudeVersion: claudeVersion(),
  pluginFor: pinnedPlugin(repo, cacheDir),
  tempRoot,
  insideRepo,
  now: () => new Date().toISOString(),
});
