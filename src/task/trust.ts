import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { IMPLICIT_ID, implicitContract, type ProjectFiles } from "./implicit.js";
import { contractHash } from "./load.js";
import { fmPaths } from "./paths.js";
import { readTrust, writeTrust } from "./state.js";

export const trustImplicit = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  root: AbsolutePath,
  files: ProjectFiles,
): string | undefined => {
  const paths = fmPaths(root);
  const hash = contractHash(implicitContract(files));
  const trust = readTrust(runtime, paths);
  const written = writeTrust(runtime, paths, { ...trust, contracts: { ...trust.contracts, [IMPLICIT_ID]: hash } });
  return written.ok ? hash : undefined;
};
