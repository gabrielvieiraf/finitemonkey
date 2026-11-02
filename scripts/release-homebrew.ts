import {
  type Architecture,
  assetFor,
  HOMEPAGE,
  isSha256,
  isVersion,
  LICENSE,
  type OperatingSystem,
  type Release,
  SUMMARY,
} from "./release-assets.js";

export const FORMULA_FILE = "finitemonkey.rb";

const HOMEBREW_OS: readonly { os: OperatingSystem; block: string }[] = [
  { os: "darwin", block: "on_macos" },
  { os: "linux", block: "on_linux" },
];

const HOMEBREW_ARCH: readonly { arch: Architecture; block: string }[] = [
  { arch: "arm64", block: "on_arm" },
  { arch: "x64", block: "on_intel" },
];

const rubyString = (value: string): string => `"${value.replace(/[\\"#]/g, (char) => `\\${char}`)}"`;

const archBlock = (release: Release, os: OperatingSystem, arch: Architecture, block: string): string[] => {
  const asset = assetFor(release, { os, arch });
  return [
    `    ${block} do`,
    `      url ${rubyString(asset.url)}`,
    `      sha256 ${rubyString(asset.sha256)}`,
    "    end",
  ];
};

const osBlock = (release: Release, os: OperatingSystem, block: string): string[] => [
  `  ${block} do`,
  ...HOMEBREW_ARCH.flatMap((item) => archBlock(release, os, item.arch, item.block)),
  "  end",
];

export const homebrewFormula = (release: Release): string =>
  [
    "class Finitemonkey < Formula",
    `  desc ${rubyString(SUMMARY)}`,
    `  homepage ${rubyString(HOMEPAGE)}`,
    `  version ${rubyString(release.version)}`,
    `  license ${rubyString(LICENSE)}`,
    "",
    ...HOMEBREW_OS.flatMap((item, index) => [...(index > 0 ? [""] : []), ...osBlock(release, item.os, item.block)]),
    "",
    "  def install",
    '    bin.install "finitemonkey"',
    '    bin.install_symlink "finitemonkey" => "fm"',
    "  end",
    "",
    "  test do",
    '    assert_match version.to_s, shell_output("#{bin}/finitemonkey --version")',
    "  end",
    "end",
    "",
  ].join("\n");

const descProblems = (desc: string): string[] => [
  ...(desc.length > 80 ? [`desc is ${String(desc.length)} characters, Homebrew allows 80`] : []),
  ...(/^(an?|the)\s/i.test(desc) ? ["desc starts with an article"] : []),
  ...(/finite\s*monkey/i.test(desc) ? ["desc repeats the formula name"] : []),
  ...(desc.endsWith(".") ? ["desc ends with a period"] : []),
];

export const validateHomebrew = (release: Release): string[] => [
  ...descProblems(SUMMARY),
  ...(isVersion(release.version) ? [] : [`version ${release.version} is not a semantic version`]),
  ...HOMEBREW_OS.flatMap(({ os }) =>
    HOMEBREW_ARCH.flatMap(({ arch }) => {
      const asset = release.assets.find((item) => item.target.os === os && item.target.arch === arch);
      if (asset === undefined) return [`formula has no ${os}-${arch} archive`];
      return [
        ...(isSha256(asset.sha256) ? [] : [`sha256 of ${asset.name} is not 64 lowercase hex characters`]),
        ...(asset.url.startsWith("https://") ? [] : [`url of ${asset.name} is not https`]),
      ];
    }),
  ),
];
