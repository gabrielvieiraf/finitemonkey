import type { AbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { contractHash, parseContract } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, readTrust, writeState, writeTrust } from "../src/task/state.js";

export const trustContract = (root: AbsolutePath, id: string, text: string): void => {
  const runtime = nodeRuntime();
  const paths = fmPaths(root);
  const parsed = parseContract(id, text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  runtime.mkdir(paths.dir);
  runtime.mkdir(fmPaths(root).dir);
  runtime.writeText(paths.task(id), text);
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [id]: contractHash(parsed.value) },
    approved: { ...lock.approved, [id]: text },
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: id });
};
