import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { CliConfig, CliRun, CliRuns } from "./cli.js";

export const runCli = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
  config: CliConfig,
  args: readonly string[],
): CliRun => {
  const [command = "", ...prefix] = config.bin;
  const result = runtime.exec({
    command,
    args: [...prefix, ...args],
    cwd: root,
    timeoutMs: config.timeoutMs,
    env: { NO_COLOR: "1" },
    unset: ["FORCE_COLOR", "CLICOLOR_FORCE"],
    input: "",
  });
  return {
    args,
    found: result.found,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  };
};

export const probeCli = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
  config: CliConfig,
): CliRuns | undefined => {
  const run = (args: readonly string[]): CliRun => runCli(runtime, root, config, args);
  const help = run(["--help"]);
  if (!help.found) return undefined;
  const timings = [
    help.durationMs,
    ...Array.from({ length: Math.max(0, config.runs - 1) }, () => run(["--help"]).durationMs),
  ];
  return {
    help,
    errors: config.errors.map(run),
    json: config.json.map(run),
    destructive: config.destructive.map((args) => run([...args, "--help"])),
    timings,
  };
};
