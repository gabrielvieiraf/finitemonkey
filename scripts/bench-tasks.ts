import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { accept, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";
import type { BenchTask } from "./bench-harness.js";

export const TASKS_DIR = "tasks";

const git = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
};

export const commitWorkspace = (workdir: string): void => {
  git(workdir, "init", "-q", "-b", "main");
  git(workdir, "config", "user.name", "Bench");
  git(workdir, "config", "user.email", "bench@example.invalid");
  git(workdir, "add", "-A");
  git(workdir, "commit", "-q", "--allow-empty", "-m", "base");
};

export const staticTask = (dir: string): Parsed<BenchTask> => {
  const parsed = parseJsonObject(readFileSync(join(dir, "task.json"), "utf8"));
  if (!parsed.ok) return reject(parsed.error);
  const { id, prompt } = parsed.value;
  if (typeof id !== "string" || typeof prompt !== "string") return reject(`${dir}: id and prompt are required`);
  const repo = join(dir, "repo");
  if (!existsSync(repo)) return reject(`${id}: repo/ is missing`);
  return accept({
    id,
    prompt: () => prompt,
    materialize: (workdir) => {
      cpSync(repo, workdir, { recursive: true });
      commitWorkspace(workdir);
    },
  });
};

export const loadTasks = (benchDir: string): Parsed<readonly BenchTask[]> => {
  const root = join(benchDir, TASKS_DIR);
  if (!existsSync(root)) return accept([]);
  const tasks: BenchTask[] = [];
  for (const name of readdirSync(root).sort()) {
    if (!existsSync(join(root, name, "task.json"))) continue;
    const task = staticTask(join(root, name));
    if (!task.ok) return reject(task.error);
    tasks.push(task.value);
  }
  return accept(tasks);
};
