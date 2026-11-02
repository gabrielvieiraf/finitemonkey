export const REPOSITORY = "gabrielvieiraf/finitemonkey";
export const HOMEPAGE = `https://github.com/${REPOSITORY}`;
export const LICENSE = "Apache-2.0";
export const PUBLISHER = "Gabriel Vieira";
export const SUMMARY = "Hooks that stop coding agents from saying done before the tests pass";
export const CHECKSUMS_FILE = "SHA256SUMS";
export const COMMANDS = ["finitemonkey", "fm"] as const;

export const OPERATING_SYSTEMS = ["darwin", "linux", "windows"] as const;
export const ARCHITECTURES = ["x64", "arm64"] as const;

export type OperatingSystem = (typeof OPERATING_SYSTEMS)[number];
export type Architecture = (typeof ARCHITECTURES)[number];

export interface Target {
  readonly os: OperatingSystem;
  readonly arch: Architecture;
}

export interface Asset {
  readonly target: Target;
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
}

export interface Release {
  readonly version: string;
  readonly assets: readonly Asset[];
}

export interface Resolved {
  readonly release: Release | undefined;
  readonly problems: readonly string[];
}

export const TARGETS: readonly Target[] = OPERATING_SYSTEMS.flatMap((os) =>
  ARCHITECTURES.map((arch) => ({ os, arch })),
);

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CHECKSUM_LINE = /^([A-Fa-f0-9]{64}) [ *]([^\s/\\]+)$/;

export const isVersion = (version: string): boolean => SEMVER.test(version);

export const isSha256 = (value: string): boolean => SHA256.test(value);

export const archiveExtension = (target: Target): string => (target.os === "windows" ? "zip" : "tar.gz");

export const binaryName = (target: Target): string => (target.os === "windows" ? "finitemonkey.exe" : "finitemonkey");

export const assetName = (version: string, target: Target): string =>
  `finitemonkey-${version}-${target.os}-${target.arch}.${archiveExtension(target)}`;

export const releaseBaseUrl = (version: string): string => `${HOMEPAGE}/releases/download/v${version}`;

export const assetUrl = (version: string, name: string): string => `${releaseBaseUrl(version)}/${name}`;

export const parseChecksums = (text: string): { sums: ReadonlyMap<string, string>; problems: string[] } => {
  const sums = new Map<string, string>();
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    const match = CHECKSUM_LINE.exec(line);
    const [, hash, name] = match ?? [];
    if (hash === undefined || name === undefined) {
      problems.push(`${CHECKSUMS_FILE} line ${String(index + 1)} is not "<sha256>  <file name>"`);
      return;
    }
    if (sums.has(name)) problems.push(`${CHECKSUMS_FILE} lists ${name} more than once`);
    sums.set(name, hash.toLowerCase());
  });
  return { sums, problems };
};

export const resolveRelease = (version: string, sums: ReadonlyMap<string, string>): Resolved => {
  if (!isVersion(version)) return { release: undefined, problems: [`${version} is not a semantic version`] };
  const problems: string[] = [];
  const assets = TARGETS.flatMap((target) => {
    const name = assetName(version, target);
    const sha256 = sums.get(name);
    if (sha256 === undefined) {
      problems.push(`no checksum for ${name}`);
      return [];
    }
    return [{ target, name, url: assetUrl(version, name), sha256 }];
  });
  return problems.length > 0 ? { release: undefined, problems } : { release: { version, assets }, problems };
};

export const assetFor = (release: Release, target: Target): Asset => {
  const asset = release.assets.find((item) => item.target.os === target.os && item.target.arch === target.arch);
  if (asset === undefined) throw new Error(`release ${release.version} has no ${target.os}-${target.arch} asset`);
  return asset;
};
