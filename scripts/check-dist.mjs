import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundle, OUTFILE } from "./bundle.mjs";

const dir = mkdtempSync(join(tmpdir(), "fm-dist-"));
try {
  const fresh = readFileSync(await bundle(join(dir, "finitemonkey.mjs")));
  let committed;
  try {
    committed = readFileSync(OUTFILE);
  } catch {
    committed = undefined;
  }
  if (!committed || !fresh.equals(committed)) {
    console.error("dist/finitemonkey.mjs is out of date with src/. Run `npm run build` and commit dist/.");
    process.exit(1);
  }
  console.log("dist/finitemonkey.mjs is up to date");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
