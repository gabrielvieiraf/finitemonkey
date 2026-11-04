import { dirname, isAbsolute, join } from "node:path";

export const COMPILE_CACHE_DIR = join(".finitemonkey", "compile-cache");

const insideRepository = (dir: string, exists: (path: string) => boolean): boolean => {
  if (exists(join(dir, ".git"))) return true;
  const parent = dirname(dir);
  return parent !== dir && insideRepository(parent, exists);
};

export const compileCacheDir = (
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
): string | undefined => {
  const home = platform === "win32" ? env["USERPROFILE"] : env["HOME"];
  if (home === undefined || !isAbsolute(home) || insideRepository(home, exists)) return undefined;
  return join(home, COMPILE_CACHE_DIR);
};

export const enableCompileCache = (nodeModule: object, dir: string | undefined): boolean => {
  const enable: unknown = Reflect.get(nodeModule, "enableCompileCache");
  if (dir === undefined || typeof enable !== "function") return false;
  try {
    Reflect.apply(enable, nodeModule, [dir]);
    return true;
  } catch {
    return false;
  }
};
