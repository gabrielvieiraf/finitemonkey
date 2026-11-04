import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENTRY = join(ROOT, "src", "cli.ts");
export const BIN_ENTRY = join(ROOT, "src", "bin.ts");
export const BIN_FILE = "finitemonkey.mjs";
export const CORE_FILE = "finitemonkey-core.mjs";
export const BUNDLE_FILES = [BIN_FILE, CORE_FILE];
export const DIST = join(ROOT, "dist");
export const PLUGIN_SCRIPTS = join(ROOT, "plugin", "scripts");
export const OUTFILE = join(DIST, BIN_FILE);
export const CORE_OUTFILE = join(DIST, CORE_FILE);
export const PLUGIN_BUNDLE = join(PLUGIN_SCRIPTS, BIN_FILE);
export const MOD_ENTRY = join(ROOT, "src", "mod", "register.ts");
export const MOD_BUNDLE = join(ROOT, "plugin", "hooks", "register.mjs");

const buildNode = async (entry, outfile) => {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    legalComments: "none",
    charset: "utf8",
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "warning",
  });
  chmodSync(outfile, 0o755);
  return outfile;
};

export const bundle = async (dir = DIST) => [
  await buildNode(BIN_ENTRY, join(dir, BIN_FILE)),
  await buildNode(ENTRY, join(dir, CORE_FILE)),
];

export const bundleMod = async (outfile = MOD_BUNDLE) => {
  await build({
    entryPoints: [MOD_ENTRY],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    legalComments: "none",
    charset: "utf8",
    external: ["claude-code"],
    logLevel: "warning",
  });
  return outfile;
};

export const copyToPlugin = (from = DIST, to = PLUGIN_SCRIPTS) => {
  mkdirSync(to, { recursive: true });
  return BUNDLE_FILES.map((name) => {
    copyFileSync(join(from, name), join(to, name));
    chmodSync(join(to, name), 0o755);
    return join(to, name);
  });
};
