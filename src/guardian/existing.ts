import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { fileAt, type Git, gitAt, untracked } from "../gate/git.js";
import { parseManifest } from "../inventory/dependencies.js";
import { isCode } from "../map/defs.js";
import type { FmPaths } from "../task/paths.js";
import { importedPackages, roleOf, stemOf } from "./roles.js";

export const MATCH_KINDS = ["dependency", "import", "name"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export interface ExistingMatch {
  readonly kind: MatchKind;
  readonly added: string;
  readonly existing: string;
  readonly role: string;
  readonly usage: string;
}

export interface ManifestEntry {
  readonly name: string;
  readonly at: string;
}

export interface DiffSnapshot {
  readonly addedDeps: readonly ManifestEntry[];
  readonly installed: readonly ManifestEntry[];
  readonly addedFiles: readonly string[];
  readonly changedFiles: readonly string[];
  readonly otherFiles: readonly string[];
}

const MANIFEST = /(^|\/)(package\.json|requirements\.txt|go\.mod)$/;
const MAX_FILES = 2000;

const lines = (text: string | undefined): readonly string[] =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const manifestsAt = (
  runtime: Pick<Runtime, "readText">,
  git: Git,
  root: FmPaths["root"],
  base: string,
  files: readonly string[],
) => {
  const now = files.flatMap((file) => {
    const text = runtime.readText(toAbsolutePath(file, root));
    return text.ok ? parseManifest(file, text.value) : [];
  });
  const before = new Set(
    files.flatMap((file) => {
      const text = fileAt(git, base, file);
      return text === undefined ? [] : parseManifest(file, text).map((item) => item.name);
    }),
  );
  return {
    addedDeps: now.filter((item) => !before.has(item.name)),
    installed: now.filter((item) => before.has(item.name)),
  };
};

export const diffSnapshot = (
  runtime: Pick<Runtime, "readText" | "exec">,
  paths: FmPaths,
  base: string,
): DiffSnapshot => {
  const git = gitAt(runtime, paths.root);
  const tracked = lines(git.out(["ls-files"]));
  const addedFiles = [
    ...new Set([...lines(git.out(["diff", "--name-only", "--diff-filter=A", base])), ...untracked(git)]),
  ];
  const changedFiles = lines(git.out(["diff", "--name-only", "--diff-filter=M", base]));
  const manifests = [...new Set([...tracked, ...addedFiles])].filter((file) => MANIFEST.test(file));
  const added = new Set(addedFiles);
  return {
    ...manifestsAt(runtime, git, paths.root, base, manifests),
    addedFiles,
    changedFiles,
    otherFiles: tracked.filter((file) => isCode(file) && !added.has(file)).slice(0, MAX_FILES),
  };
};

const dependencyMatches = (snap: DiffSnapshot): readonly ExistingMatch[] =>
  snap.addedDeps.flatMap((dep) => {
    const role = roleOf(dep.name);
    const same = role === undefined ? undefined : snap.installed.find((item) => roleOf(item.name) === role);
    return same === undefined || role === undefined
      ? []
      : [{ kind: "dependency", added: dep.name, existing: same.name, role, usage: same.at }];
  });

const importsIn = (runtime: Pick<Runtime, "readText">, root: FmPaths["root"], file: string): readonly string[] => {
  const text = runtime.readText(toAbsolutePath(file, root));
  return text.ok ? importedPackages(text.value) : [];
};

const importMatches = (
  runtime: Pick<Runtime, "readText">,
  root: FmPaths["root"],
  snap: DiffSnapshot,
): readonly ExistingMatch[] => {
  const used = snap.addedFiles.filter(isCode).flatMap((file) =>
    importsIn(runtime, root, file).flatMap((name) => {
      const role = roleOf(name);
      return role === undefined ? [] : [{ file, name, role }];
    }),
  );
  return used.flatMap(({ file, name, role }) => {
    const owner = snap.otherFiles.find((other) =>
      importsIn(runtime, root, other).some((item) => roleOf(item) === role && item !== name),
    );
    return owner === undefined
      ? []
      : [{ kind: "import", added: `${file} (${name})`, existing: owner, role, usage: owner }];
  });
};

const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^.]+$/;

const nameMatches = (snap: DiffSnapshot): readonly ExistingMatch[] =>
  snap.addedFiles
    .filter((file) => isCode(file) && !TEST_FILE.test(file))
    .flatMap((file) => {
      const stem = stemOf(file);
      const twin = snap.otherFiles.find((other) => !TEST_FILE.test(other) && stemOf(other) === stem);
      return twin === undefined ? [] : [{ kind: "name", added: file, existing: twin, role: stem, usage: twin }];
    });

export const existingMatches = (
  runtime: Pick<Runtime, "readText">,
  root: FmPaths["root"],
  snap: DiffSnapshot,
): readonly ExistingMatch[] => {
  const byDependency = dependencyMatches(snap);
  const byImport = importMatches(runtime, root, snap);
  const seen = new Set([...byDependency, ...byImport].map((item) => item.existing));
  return [...byDependency, ...byImport, ...nameMatches(snap).filter((item) => !seen.has(item.existing))];
};

export const findExisting = (
  runtime: Pick<Runtime, "readText" | "exec">,
  paths: FmPaths,
  base = "HEAD",
): readonly ExistingMatch[] => existingMatches(runtime, paths.root, diffSnapshot(runtime, paths, base));
