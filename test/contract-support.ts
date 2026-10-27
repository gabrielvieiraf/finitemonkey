import { contractHash, parseContract } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, readTrust, writeState, writeTrust } from "../src/task/state.js";
import type { Repo } from "./repo.js";
import { repoRuntime } from "./repo.js";

export const activateContract = (
  repo: Repo,
  id: string,
  checks: readonly string[],
  extra: readonly string[] = [],
): void => {
  const text = [
    `id: ${id}`,
    "goal: planned change",
    "size: S",
    ...extra,
    "acceptance:",
    ...checks.flatMap((check) => [`  - id: ${check}`, `    check: ${check}`]),
    "",
  ].join("\n");
  const parsed = parseContract(id, text);
  if (!parsed.ok) throw new Error(`bad contract: ${JSON.stringify(parsed.error)}`);
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  runtime.writeText(paths.task(id), text);
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [id]: contractHash(parsed.value) },
    approved: { ...lock.approved, [id]: text },
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: id });
};
