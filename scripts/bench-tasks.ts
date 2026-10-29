import { spawnSync } from "node:child_process";

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
