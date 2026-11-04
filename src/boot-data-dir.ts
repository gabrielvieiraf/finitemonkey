import { findProjectRoot } from "./core/data-dir-layout.js";
import { prepareDataDir } from "./core/data-dir-migrate.js";
import { nodeDataDirFs } from "./core/data-dir-node.js";

if (process.env["FINITEMONKEY_NO_MIGRATE"] === undefined) {
  prepareDataDir(nodeDataDirFs, findProjectRoot(nodeDataDirFs, process.cwd()));
}
