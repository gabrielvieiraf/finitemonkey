import { parseChecksums, resolveRelease } from "./release-assets.js";
import { FORMULA_FILE, homebrewFormula, validateHomebrew } from "./release-homebrew.js";
import { SCOOP_FILE, scoopJson, scoopManifest, validateScoop } from "./release-scoop.js";
import { validateWinget, wingetFiles, wingetYaml } from "./release-winget.js";

export interface OutputFile {
  readonly path: string;
  readonly content: string;
}

export interface ManifestResult {
  readonly files: readonly OutputFile[];
  readonly problems: readonly string[];
}

export const releaseManifests = (version: string, checksums: string): ManifestResult => {
  const parsed = parseChecksums(checksums);
  const resolved = resolveRelease(version, parsed.sums);
  const release = resolved.release;
  if (parsed.problems.length > 0 || release === undefined) {
    return { files: [], problems: [...parsed.problems, ...resolved.problems] };
  }
  const scoop = scoopManifest(release);
  const winget = wingetFiles(release);
  const problems = [
    ...validateHomebrew(release).map((problem) => `homebrew: ${problem}`),
    ...validateScoop(scoop).map((problem) => `scoop: ${problem}`),
    ...validateWinget(winget).map((problem) => `winget: ${problem}`),
  ];
  if (problems.length > 0) return { files: [], problems };
  return {
    files: [
      { path: `homebrew/${FORMULA_FILE}`, content: homebrewFormula(release) },
      { path: `scoop/${SCOOP_FILE}`, content: scoopJson(scoop) },
      ...winget.map((file) => ({ path: `winget/${file.path}`, content: wingetYaml(file) })),
    ],
    problems: [],
  };
};
