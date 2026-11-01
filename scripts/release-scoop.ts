import {
  type Architecture,
  assetFor,
  assetName,
  CHECKSUMS_FILE,
  HOMEPAGE,
  isSha256,
  isVersion,
  LICENSE,
  type Release,
  releaseBaseUrl,
  SUMMARY,
} from "./release-assets.js";

export const SCOOP_FILE = "finitemonkey.json";

const SCOOP_ARCH: readonly { arch: Architecture; key: string }[] = [
  { arch: "x64", key: "64bit" },
  { arch: "arm64", key: "arm64" },
];

const VERSION_TOKEN = "$version";

export interface ScoopManifest {
  readonly version: string;
  readonly description: string;
  readonly homepage: string;
  readonly license: string;
  readonly architecture: Readonly<Record<string, { readonly url: string; readonly hash: string }>>;
  readonly bin: readonly (string | readonly string[])[];
  readonly checkver: { readonly github: string };
  readonly autoupdate: {
    readonly architecture: Readonly<Record<string, { readonly url: string }>>;
    readonly hash: { readonly url: string };
  };
}

export const scoopManifest = (release: Release): ScoopManifest => ({
  version: release.version,
  description: SUMMARY,
  homepage: HOMEPAGE,
  license: LICENSE,
  architecture: Object.fromEntries(
    SCOOP_ARCH.map(({ arch, key }) => {
      const asset = assetFor(release, { os: "windows", arch });
      return [key, { url: asset.url, hash: asset.sha256 }];
    }),
  ),
  bin: ["finitemonkey.exe", ["finitemonkey.exe", "fm"]],
  checkver: { github: HOMEPAGE },
  autoupdate: {
    architecture: Object.fromEntries(
      SCOOP_ARCH.map(({ arch, key }) => [
        key,
        { url: `${releaseBaseUrl(VERSION_TOKEN)}/${assetName(VERSION_TOKEN, { os: "windows", arch })}` },
      ]),
    ),
    hash: { url: `$baseurl/${CHECKSUMS_FILE}` },
  },
});

export const scoopJson = (manifest: ScoopManifest): string => `${JSON.stringify(manifest, null, 4)}\n`;

export const validateScoop = (manifest: ScoopManifest): string[] => [
  ...(isVersion(manifest.version) ? [] : [`version ${manifest.version} is not a semantic version`]),
  ...(manifest.homepage.startsWith("https://") ? [] : ["homepage is not https"]),
  ...(manifest.license === "" ? ["license is empty"] : []),
  ...(manifest.description === "" ? ["description is empty"] : []),
  ...SCOOP_ARCH.flatMap(({ key }) => {
    const entry = manifest.architecture[key];
    if (entry === undefined) return [`architecture ${key} is missing`];
    return [
      ...(isSha256(entry.hash) ? [] : [`hash of ${key} is not 64 lowercase hex characters`]),
      ...(entry.url.startsWith("https://") ? [] : [`url of ${key} is not https`]),
      ...(manifest.autoupdate.architecture[key]?.url.includes(VERSION_TOKEN) === true
        ? []
        : [`autoupdate url of ${key} does not use ${VERSION_TOKEN}`]),
    ];
  }),
];
