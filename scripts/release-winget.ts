import { ARCHITECTURES, assetFor, HOMEPAGE, LICENSE, PUBLISHER, type Release, SUMMARY } from "./release-assets.js";

export const WINGET_IDENTIFIER = "GabrielVieira.FiniteMonkey";
export const WINGET_MANIFEST_VERSION = "1.6.0";
export const WINGET_LOCALE = "en-US";

type Scalar = string | number;
type YamlValue = Scalar | readonly YamlValue[] | { readonly [key: string]: YamlValue };
type YamlObject = Readonly<Record<string, YamlValue>>;

export interface WingetFile {
  readonly path: string;
  readonly schema: string;
  readonly manifest: YamlObject;
}

const IDENTIFIER_PART = /^[^.\s\\/:*?"<>|]{1,32}$/;
const PACKAGE_VERSION = /^[^\\/:*?"<>|]{1,128}$/;
const WINGET_SHA256 = /^[A-Fa-f0-9]{64}$/;
const MANIFEST_TYPES = ["version", "installer", "defaultLocale"] as const;
const WINGET_ARCH = ["x86", "x64", "arm", "arm64", "neutral"];

const LOCALE_LIMITS: readonly (readonly [string, number, number])[] = [
  ["PackageLocale", 2, 20],
  ["Publisher", 2, 256],
  ["PackageName", 2, 256],
  ["License", 3, 512],
  ["ShortDescription", 3, 256],
];

const schemaUrl = (type: string): string =>
  `https://aka.ms/winget-manifest.${type}.${WINGET_MANIFEST_VERSION}.schema.json`;

const header = (release: Release): YamlObject => ({
  PackageIdentifier: WINGET_IDENTIFIER,
  PackageVersion: release.version,
});

const footer = (type: (typeof MANIFEST_TYPES)[number]): YamlObject => ({
  ManifestType: type,
  ManifestVersion: WINGET_MANIFEST_VERSION,
});

const installer = (release: Release): YamlObject => ({
  ...header(release),
  InstallerType: "zip",
  NestedInstallerType: "portable",
  NestedInstallerFiles: [{ RelativeFilePath: "finitemonkey.exe", PortableCommandAlias: "finitemonkey" }],
  Installers: ARCHITECTURES.map((arch) => {
    const asset = assetFor(release, { os: "windows", arch });
    return { Architecture: arch, InstallerUrl: asset.url, InstallerSha256: asset.sha256.toUpperCase() };
  }),
  ...footer("installer"),
});

const locale = (release: Release): YamlObject => ({
  ...header(release),
  PackageLocale: WINGET_LOCALE,
  Publisher: PUBLISHER,
  PublisherUrl: "https://github.com/gabrielvieiraf",
  PackageName: "Finite Monkey",
  PackageUrl: HOMEPAGE,
  License: LICENSE,
  LicenseUrl: `${HOMEPAGE}/blob/main/LICENSE`,
  ShortDescription: SUMMARY,
  Moniker: "finitemonkey",
  Tags: ["claude-code", "hooks", "coding-agent", "definition-of-done"],
  ReleaseNotesUrl: `${HOMEPAGE}/releases/tag/v${release.version}`,
  ...footer("defaultLocale"),
});

export const wingetDirectory = (version: string): string =>
  ["manifests", WINGET_IDENTIFIER[0]?.toLowerCase() ?? "", ...WINGET_IDENTIFIER.split("."), version].join("/");

export const wingetFiles = (release: Release): WingetFile[] => {
  const dir = wingetDirectory(release.version);
  return [
    {
      path: `${dir}/${WINGET_IDENTIFIER}.yaml`,
      schema: schemaUrl("version"),
      manifest: { ...header(release), DefaultLocale: WINGET_LOCALE, ...footer("version") },
    },
    {
      path: `${dir}/${WINGET_IDENTIFIER}.installer.yaml`,
      schema: schemaUrl("installer"),
      manifest: installer(release),
    },
    {
      path: `${dir}/${WINGET_IDENTIFIER}.locale.${WINGET_LOCALE}.yaml`,
      schema: schemaUrl("defaultLocale"),
      manifest: locale(release),
    },
  ];
};

const scalar = (value: Scalar): string => (typeof value === "number" ? String(value) : JSON.stringify(value));

const yamlLines = (value: YamlValue, indent: string): string[] => {
  if (typeof value === "string" || typeof value === "number") return [`${indent}${scalar(value)}`];
  if (Array.isArray(value)) return value.flatMap((item: YamlValue) => listItem(item, indent));
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === "string" || typeof item === "number"
      ? [`${indent}${key}: ${scalar(item)}`]
      : [`${indent}${key}:`, ...yamlLines(item, `${indent}  `)],
  );
};

const listItem = (item: YamlValue, indent: string): string[] => {
  const [first = "", ...rest] = yamlLines(item, `${indent}  `);
  return [`${indent}- ${first.slice(indent.length + 2)}`, ...rest];
};

export const wingetYaml = (file: WingetFile): string =>
  [`# yaml-language-server: $schema=${file.schema}`, "", ...yamlLines(file.manifest, ""), ""].join("\n");

const printable = (value: string): boolean =>
  Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)).every((code) => code >= 0x20);

const isIdentifier = (value: string): boolean => {
  const parts = value.split(".");
  return (
    parts.length >= 2 && parts.length <= 8 && printable(value) && parts.every((part) => IDENTIFIER_PART.test(part))
  );
};

const isPackageVersion = (value: string): boolean => printable(value) && PACKAGE_VERSION.test(value);

const isObject = (value: YamlValue): value is YamlObject => typeof value === "object" && !Array.isArray(value);

const text = (manifest: YamlObject, key: string): string => {
  const value = manifest[key];
  return typeof value === "string" ? value : "";
};

const lengthProblem = (manifest: YamlObject, key: string, min: number, max: number): string[] => {
  const value = text(manifest, key);
  return value.length >= min && value.length <= max
    ? []
    : [`${key} must have ${String(min)} to ${String(max)} characters`];
};

const installerProblems = (manifest: YamlObject): string[] => {
  const installers = manifest["Installers"];
  if (!Array.isArray(installers) || installers.length === 0) return ["Installers is empty"];
  return installers.flatMap((item: YamlValue, index: number) => {
    if (!isObject(item)) return [`Installers[${String(index)}] is not an object`];
    const entry = item;
    return [
      ...(WINGET_ARCH.includes(text(entry, "Architecture"))
        ? []
        : [`Installers[${String(index)}].Architecture is invalid`]),
      ...(text(entry, "InstallerUrl").startsWith("https://")
        ? []
        : [`Installers[${String(index)}].InstallerUrl is invalid`]),
      ...(WINGET_SHA256.test(text(entry, "InstallerSha256"))
        ? []
        : [`Installers[${String(index)}].InstallerSha256 is invalid`]),
    ];
  });
};

const typeProblems = (manifest: YamlObject): string[] => {
  switch (text(manifest, "ManifestType")) {
    case "version":
      return text(manifest, "DefaultLocale") === "" ? ["DefaultLocale is missing"] : [];
    case "installer":
      return installerProblems(manifest);
    case "defaultLocale":
      return LOCALE_LIMITS.flatMap(([key, min, max]) => lengthProblem(manifest, key, min, max));
    default:
      return [`ManifestType ${text(manifest, "ManifestType")} is not one of ${MANIFEST_TYPES.join(", ")}`];
  }
};

export const validateWinget = (files: readonly WingetFile[]): string[] => {
  const types = files.map((file) => text(file.manifest, "ManifestType"));
  return [
    ...MANIFEST_TYPES.filter((type) => !types.includes(type)).map((type) => `no ${type} manifest`),
    ...files.flatMap((file) =>
      [
        ...(isIdentifier(text(file.manifest, "PackageIdentifier")) ? [] : ["PackageIdentifier is invalid"]),
        ...(isPackageVersion(text(file.manifest, "PackageVersion")) ? [] : ["PackageVersion is invalid"]),
        ...(text(file.manifest, "ManifestVersion") === WINGET_MANIFEST_VERSION ? [] : ["ManifestVersion is invalid"]),
        ...typeProblems(file.manifest),
      ].map((problem) => `${file.path}: ${problem}`),
    ),
  ];
};
