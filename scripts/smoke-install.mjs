import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT } from "./bundle.mjs";

const isWindows = process.platform === "win32";
const base = mkdtempSync(join(tmpdir(), "fm-smoke-"));
const prefix = join(base, "Área de Trabalho", "prefixo com espaço");
mkdirSync(prefix, { recursive: true });
const npm = (args, cwd) =>
  execFileSync(isWindows ? "npm.cmd" : "npm", args, { cwd, encoding: "utf8", shell: isWindows });

try {
  npm(["pack", "--pack-destination", base, "--silent"], ROOT);
  const tarball = readdirSync(base).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack produced no tarball");
  npm(["install", "--global", "--prefix", prefix, join(base, tarball), "--silent", "--no-audit", "--no-fund"], ROOT);
  const binDir = isWindows ? prefix : join(prefix, "bin");
  for (const name of ["finitemonkey", "fm"]) {
    const bin = join(binDir, isWindows ? `${name}.cmd` : name);
    const result = spawnSync(bin, ["--version"], { encoding: "utf8", shell: isWindows });
    const out = (result.stdout ?? "").trim();
    if (result.status !== 0 || out === "") {
      console.error(
        `${name} --version from "${prefix}" failed: status ${result.status}, stdout "${out}", stderr "${result.stderr}"`,
      );
      process.exit(1);
    }
    console.log(`${name} --version from "${prefix}": ${out}`);
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
