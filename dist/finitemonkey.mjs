#!/usr/bin/env node

// src/bin.ts
import { existsSync } from "node:fs";
import * as nodeModule from "node:module";

// src/core/bundle-files.ts
var CORE_FILE = "finitemonkey-core.mjs";

// src/core/compile-cache.ts
import { dirname, isAbsolute, join } from "node:path";

// src/core/data-dir-name.ts
var HOME_DATA_DIR = ".finitemonkey";

// src/core/compile-cache.ts
var COMPILE_CACHE_DIR = join(HOME_DATA_DIR, "compile-cache");
var insideRepository = (dir, exists) => {
  if (exists(join(dir, ".git"))) return true;
  const parent = dirname(dir);
  return parent !== dir && insideRepository(parent, exists);
};
var compileCacheDir = (env, platform, exists) => {
  const home = platform === "win32" ? env["USERPROFILE"] : env["HOME"];
  if (home === void 0 || !isAbsolute(home) || insideRepository(home, exists)) return void 0;
  return join(home, COMPILE_CACHE_DIR);
};
var enableCompileCache = (nodeModule2, dir) => {
  const enable = Reflect.get(nodeModule2, "enableCompileCache");
  if (dir === void 0 || typeof enable !== "function") return false;
  try {
    Reflect.apply(enable, nodeModule2, [dir]);
    return true;
  } catch {
    return false;
  }
};

// src/bin.ts
enableCompileCache(nodeModule, compileCacheDir(process.env, process.platform, existsSync));
var core = await import(new URL(CORE_FILE, import.meta.url).href);
var main = typeof core === "object" && core !== null ? Reflect.get(core, "main") : void 0;
if (typeof main !== "function") throw new Error(`${CORE_FILE} does not export main`);
await Reflect.apply(main, void 0, []);
