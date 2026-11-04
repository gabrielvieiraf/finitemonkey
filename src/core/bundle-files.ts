import { basename, dirname, join } from "node:path";

export const BIN_FILE = "finitemonkey.mjs";
export const CORE_FILE = "finitemonkey-core.mjs";

export const corePath = (binPath: string): string => join(dirname(binPath), CORE_FILE);

export const binPath = (modulePath: string): string =>
  basename(modulePath) === CORE_FILE ? join(dirname(modulePath), BIN_FILE) : modulePath;
