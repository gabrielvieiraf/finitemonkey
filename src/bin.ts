import { existsSync } from "node:fs";
import * as nodeModule from "node:module";

import { CORE_FILE } from "./core/bundle-files.js";
import { compileCacheDir, enableCompileCache } from "./core/compile-cache.js";

enableCompileCache(nodeModule, compileCacheDir(process.env, process.platform, existsSync));
const core: unknown = await import(new URL(CORE_FILE, import.meta.url).href);
const main: unknown = typeof core === "object" && core !== null ? Reflect.get(core, "main") : undefined;
if (typeof main !== "function") throw new Error(`${CORE_FILE} does not export main`);
await Reflect.apply(main, undefined, []);
