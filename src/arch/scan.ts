import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type BaselineEntry, stableFindingId } from "../findings/baseline.js";
import { type Change, EMPTY_TREE, fileAt, type Git } from "../gate/git.js";
import type { ArchConfig } from "./config.js";
import { goModuleOf, importEdges, type SourceTree } from "./imports.js";
import { type ArchViolation, archViolations, violationFingerprint } from "./violations.js";

export const ARCH_CHECK = "arch";
export const ADOPTION_OWNER = "arch adoption";
export const ADOPTION_EXPIRES = "9999-12-31";
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|java|kt)$/;

export interface ArchFinding {
  readonly id: string;
  readonly violation: ArchViolation;
}

const nul = (text: string | undefined): readonly string[] => (text ?? "").split("\0").filter((part) => part !== "");

const sourceOnly = (files: readonly string[]): readonly string[] =>
  files.filter((file) => SOURCE.test(file) && !file.split("/").includes("node_modules"));

export const workingTree = (
  runtime: Pick<Runtime, "readText">,
  git: Git,
  root: AbsolutePath,
  changes: readonly Change[],
): SourceTree => {
  const deleted = new Set(changes.filter((change) => change.status === "D").map((change) => change.path));
  const added = changes.filter((change) => change.status !== "D").map((change) => change.path);
  const tracked = nul(git.out(["ls-files", "-z"]));
  const read = (path: string): string | undefined => {
    const text = runtime.readText(toAbsolutePath(join(root, path)));
    return text.ok ? text.value : undefined;
  };
  const files = sourceOnly([...new Set([...tracked, ...added])].filter((file) => !deleted.has(file)));
  return { files, read, goModule: goModuleOf(read("go.mod")) };
};

export const baseTree = (git: Git, base: string): SourceTree => {
  if (base === EMPTY_TREE) return { files: [], read: () => undefined, goModule: undefined };
  const read = (path: string): string | undefined => fileAt(git, base, path);
  return {
    files: sourceOnly(nul(git.out(["ls-tree", "-r", "-z", "--name-only", base]))),
    read,
    goModule: goModuleOf(read("go.mod")),
  };
};

export const archFindings = (config: ArchConfig, tree: SourceTree): readonly ArchFinding[] =>
  archViolations(config, importEdges(tree)).map((violation) => ({
    id: stableFindingId(ARCH_CHECK, violation.rule, violation.from, violationFingerprint(violation)),
    violation,
  }));

export const adoptionEntry = (finding: ArchFinding, now: string): BaselineEntry => ({
  check: ARCH_CHECK,
  id: finding.id,
  rule: finding.violation.rule,
  file: finding.violation.from,
  line: finding.violation.line,
  fingerprint: violationFingerprint(finding.violation),
  state: "aceito",
  owner: ADOPTION_OWNER,
  reason: `${finding.violation.from} -> ${finding.violation.to}`,
  acceptedAt: now,
  expiresAt: ADOPTION_EXPIRES,
});
