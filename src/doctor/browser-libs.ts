import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Check, DoctorEnv } from "./types.js";
import { finding } from "./types.js";

const LDD_TIMEOUT_MS = 10_000;

export const LIB_PACKAGES: Readonly<Record<string, string>> = {
  "libnss3.so": "libnss3",
  "libnssutil3.so": "libnss3",
  "libsmime3.so": "libnss3",
  "libnspr4.so": "libnspr4",
  "libatk-1.0.so.0": "libatk1.0-0",
  "libatk-bridge-2.0.so.0": "libatk-bridge2.0-0",
  "libatspi.so.0": "libatspi2.0-0",
  "libcups.so.2": "libcups2",
  "libdrm.so.2": "libdrm2",
  "libgbm.so.1": "libgbm1",
  "libxkbcommon.so.0": "libxkbcommon0",
  "libXcomposite.so.1": "libxcomposite1",
  "libXdamage.so.1": "libxdamage1",
  "libXfixes.so.3": "libxfixes3",
  "libXrandr.so.2": "libxrandr2",
  "libXext.so.6": "libxext6",
  "libX11.so.6": "libx11-6",
  "libxcb.so.1": "libxcb1",
  "libpango-1.0.so.0": "libpango-1.0-0",
  "libcairo.so.2": "libcairo2",
  "libasound.so.2": "libasound2",
  "libdbus-1.so.3": "libdbus-1-3",
  "libexpat.so.1": "libexpat1",
  "libglib-2.0.so.0": "libglib2.0-0",
  "libgobject-2.0.so.0": "libglib2.0-0",
  "libgio-2.0.so.0": "libglib2.0-0",
};

const BINARIES = [
  ["chrome-linux", "chrome"],
  ["chrome-linux", "headless_shell"],
  ["chrome-linux64", "chrome"],
  ["chrome-headless-shell-linux64", "chrome-headless-shell"],
] as const;

export const missingLibraries = (ldd: string): readonly string[] =>
  [
    ...new Set(
      ldd.split(/\r?\n/).flatMap((line) => {
        const match = /^\s*(\S+)\s+=>\s+not found/.exec(line);
        return match?.[1] === undefined ? [] : [match[1]];
      }),
    ),
  ].sort();

export const packagesFor = (libraries: readonly string[]): readonly string[] =>
  [...new Set(libraries.map((library) => LIB_PACKAGES[library] ?? library))].sort();

const browsersDir = (env: DoctorEnv): string => {
  const declared = env.env["PLAYWRIGHT_BROWSERS_PATH"];
  return declared !== undefined && declared !== "" && declared !== "0"
    ? declared
    : join(env.runtime.homeDir(), ".cache", "ms-playwright");
};

export const browserBinaries = (env: DoctorEnv): readonly string[] => {
  const dir = browsersDir(env);
  const entries = env.runtime.listDir(toAbsolutePath(dir));
  if (!entries.ok) return [];
  return entries.value
    .filter((entry) => entry.startsWith("chromium"))
    .flatMap((entry) => BINARIES.map(([folder, name]) => join(dir, entry, folder, name)))
    .filter((path) => env.runtime.stat(toAbsolutePath(path))?.kind === "file");
};

export const checkBrowserLibraries: Check = (env) => {
  if (env.platform !== "linux") return [];
  const missing = browserBinaries(env).flatMap((binary) => {
    const result = env.runtime.exec({
      command: "ldd",
      args: [binary],
      cwd: env.cwd,
      timeoutMs: LDD_TIMEOUT_MS,
    });
    return result.found ? missingLibraries(result.stdout) : [];
  });
  if (missing.length === 0) return [];
  const libraries = [...new Set(missing)].sort();
  const packages = packagesFor(libraries).join(" ");
  return [
    finding(
      "browser.libraries",
      "warn",
      "doctor.browser.libraries",
      { libraries: libraries.join(", "), packages },
      "doctor.browser.fix_libraries",
    ),
  ];
};
