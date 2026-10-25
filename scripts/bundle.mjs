import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENTRY = join(ROOT, "src", "cli.ts");
export const OUTFILE = join(ROOT, "dist", "finitemonkey.mjs");

export const bundle = async (outfile = OUTFILE) => {
  await build({
    entryPoints: [ENTRY],
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
