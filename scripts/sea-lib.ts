import { type Architecture, ARCHITECTURES, assetName, binaryName, isVersion, type Target } from "./release-assets.js";

export const SEA_CONFIG_FILE = "sea-config.json";
export const SEA_DIR = "build/sea";
export const SEA_ENTRY = `${SEA_DIR}/finitemonkey.cjs`;
export const SEA_BLOB = `${SEA_DIR}/sea-prep.blob`;
export const SEA_RESOURCE = "NODE_SEA_BLOB";
export const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
export const SEA_MACHO_SEGMENT = "NODE_SEA";
export const SEA_URL_GLOBAL = "__finitemonkeySeaUrl";
export const SEA_NODE_MAJOR = 24;

export interface SeaConfig {
  readonly main: string;
  readonly output: string;
  readonly disableExperimentalSEAWarning: boolean;
  readonly useSnapshot: boolean;
  readonly useCodeCache: boolean;
}

export const seaConfig = (): SeaConfig => ({
  main: SEA_ENTRY,
  output: SEA_BLOB,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
});

const SHEBANG = /^#![^\n]*\n/;
const ENTRY_CALL =
  /^if \(isEntryPoint\(import\.meta\.url, process\.argv\[1\], nodeRealpath, process\.platform\)\) await main\(\);$/gm;
const VERSION_READ = /readPackageVersion\(runtime\.readText, import\.meta\.url\)/g;

export interface SeaSource {
  readonly source: string;
  readonly problems: readonly string[];
}

const countOf = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length;

export const seaEntrySource = (bundle: string, version: string): SeaSource => {
  const problems = [
    ...(isVersion(version) ? [] : [`${version} is not a semantic version`]),
    ...(countOf(bundle, ENTRY_CALL) === 1 ? [] : ["the bundle does not end with exactly one isEntryPoint call"]),
    ...(countOf(bundle, VERSION_READ) === 1 ? [] : ["the bundle does not read its version exactly once"]),
  ];
  if (problems.length > 0) return { source: "", problems };
  const source = bundle
    .replace(SHEBANG, "")
    .replace(ENTRY_CALL, "void main();")
    .replace(VERSION_READ, JSON.stringify(version));
  return { source, problems: [] };
};

export const seaBanner = (): string =>
  `const ${SEA_URL_GLOBAL} = require("node:url").pathToFileURL(process.execPath).href;`;

export interface SeaBundleOptions {
  readonly stdin: { readonly contents: string; readonly loader: "js"; readonly resolveDir: string };
  readonly outfile: string;
  readonly bundle: true;
  readonly platform: "node";
  readonly format: "cjs";
  readonly target: string;
  readonly define: Readonly<Record<string, string>>;
  readonly banner: { readonly js: string };
  readonly legalComments: "none";
  readonly charset: "utf8";
  readonly logLevel: "warning";
}

export const seaBundleOptions = (source: string, resolveDir: string, outfile: string): SeaBundleOptions => ({
  stdin: { contents: source, loader: "js", resolveDir },
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: `node${String(SEA_NODE_MAJOR)}`,
  define: { "import.meta.url": SEA_URL_GLOBAL },
  banner: { js: seaBanner() },
  legalComments: "none",
  charset: "utf8",
  logLevel: "warning",
});

const isArchitecture = (arch: string): arch is Architecture => ARCHITECTURES.some((item) => item === arch);

export const targetFor = (platform: NodeJS.Platform, arch: string): Target | undefined => {
  if (!isArchitecture(arch)) return undefined;
  if (platform === "darwin" || platform === "linux") return { os: platform, arch };
  return platform === "win32" ? { os: "windows", arch } : undefined;
};

export const seaBinary = (target: Target): string => `${SEA_DIR}/${binaryName(target)}`;

export const seaAsset = (version: string, target: Target): string => assetName(version, target);

export type Command = readonly [string, ...string[]];

export const blobCommand = (node: string): Command => [node, "--experimental-sea-config", SEA_CONFIG_FILE];

export const postjectCommand = (node: string, cli: string, target: Target): Command => [
  node,
  cli,
  seaBinary(target),
  SEA_RESOURCE,
  SEA_BLOB,
  "--sentinel-fuse",
  SEA_FUSE,
  ...(target.os === "darwin" ? ["--macho-segment-name", SEA_MACHO_SEGMENT] : []),
];

export const unsignCommands = (target: Target): readonly Command[] =>
  target.os === "darwin" ? [["codesign", "--remove-signature", seaBinary(target)]] : [];

export const adHocSignCommands = (target: Target): readonly Command[] =>
  target.os === "darwin" ? [["codesign", "--sign", "-", seaBinary(target)]] : [];

export const nodeProblems = (nodeVersion: string): string[] => {
  const major = Number(nodeVersion.split(".")[0]);
  return major === SEA_NODE_MAJOR
    ? []
    : [`build the binary with Node.js ${String(SEA_NODE_MAJOR)}, this is Node.js ${nodeVersion}`];
};

export interface Ran {
  readonly status: number | null;
  readonly stdout: string;
}

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const doctorProblems = (doctor: Ran): string[] => {
  if (doctor.status !== 0 && doctor.status !== 1) return [`doctor --json exited with ${String(doctor.status)}`];
  const parsed = parsedJson(doctor.stdout);
  const data: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "data") : undefined;
  const schema: unknown = typeof data === "object" && data !== null ? Reflect.get(data, "schema") : undefined;
  const checks: unknown = typeof data === "object" && data !== null ? Reflect.get(data, "checks") : undefined;
  if (schema !== "finitemonkey/doctor@1") return ["doctor --json did not print a finitemonkey/doctor@1 payload"];
  return Array.isArray(checks) && checks.length > 0 ? [] : ["doctor --json printed no checks"];
};

export const smokeProblems = (version: string, printed: Ran, doctor: Ran): string[] => [
  ...(printed.status === 0 ? [] : [`--version exited with ${String(printed.status)}`]),
  ...(printed.stdout.trim() === version ? [] : [`--version printed "${printed.stdout.trim()}", expected ${version}`]),
  ...doctorProblems(doctor),
];
