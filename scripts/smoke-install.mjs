import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT } from "./bundle.mjs";

const isWindows = process.platform === "win32";
const base = mkdtempSync(join(tmpdir(), "fm-smoke-"));
const prefix = join(base, "Área de Trabalho", "prefixo com espaço");
mkdirSync(prefix, { recursive: true });

const quote = (value) => `"${value.replace(/"/g, '""')}"`;

const exec = (file, args, cwd) => {
  const result = isWindows
    ? spawnSync([file, ...args].map(quote).join(" "), {
        cwd,
        encoding: "utf8",
        shell: true,
        windowsVerbatimArguments: true,
      })
    : spawnSync(file, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
};

const must = (file, args, cwd) => {
  const result = exec(file, args, cwd);
  if (result.status !== 0) throw new Error(`${file} ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  return result;
};

try {
  const npm = isWindows ? "npm.cmd" : "npm";
  must(npm, ["pack", "--pack-destination", base, "--silent"], ROOT);
  const tarball = readdirSync(base).find((name) => name.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("npm pack produced no tarball");
  must(
    npm,
    ["install", "--global", "--prefix", prefix, join(base, tarball), "--silent", "--no-audit", "--no-fund"],
    ROOT,
  );
  const binDir = isWindows ? prefix : join(prefix, "bin");
  for (const name of ["finitemonkey", "fm"]) {
    const bin = join(binDir, isWindows ? `${name}.cmd` : name);
    const result = exec(bin, ["--version"], base);
    if (result.status !== 0 || result.stdout === "") {
      console.error(
        `${name} --version from "${prefix}" failed: status ${result.status}, stdout "${result.stdout}", stderr "${result.stderr}"`,
      );
      process.exit(1);
    }
    console.log(`${name} --version from "${prefix}": ${result.stdout}`);
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
