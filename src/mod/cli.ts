import type { ModApi } from "./api.js";

export const CLI_TIMEOUT_MS = 20_000;

export function cliArgv($: ModApi, args: readonly string[]): readonly string[] {
  return ["node", `${$.plugin.root}/scripts/finitemonkey.mjs`, ...args];
}

export async function runCli($: ModApi, args: readonly string[]): Promise<string | undefined> {
  const root = await $.session.root();
  const result = await $.process.run(cliArgv($, args), { cwd: root, timeoutMs: CLI_TIMEOUT_MS });
  return result.exitCode === 0 ? result.stdout : undefined;
}
