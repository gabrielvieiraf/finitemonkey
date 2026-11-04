import { dataDirFor, dataDirState, findProjectRoot } from "./data-dir-layout.js";
import { nodeDirProbe } from "./data-dir-node.js";

export { DATA_DIR_NAME, DATA_DIR_NAMES, HOME_DATA_DIR, LEGACY_DATA_DIR } from "./data-dir-layout.js";

export const DATA_DIR: string = dataDirFor(dataDirState(nodeDirProbe, findProjectRoot(nodeDirProbe, process.cwd())));
