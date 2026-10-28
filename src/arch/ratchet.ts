import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type Baseline, loadBaseline, ratchetFor, saveBaseline, withoutFixed } from "../findings/baseline.js";
import type { Git } from "../gate/git.js";
import type { FmPaths } from "../task/paths.js";
import type { ArchConfig } from "./config.js";
import type { SourceTree } from "./imports.js";
import { adoptionEntry, ARCH_CHECK, type ArchFinding, archFindings, baseTree } from "./scan.js";

const ADOPTED_MARKER = "arch-adopted";

export interface ArchRatchet {
  readonly fresh: readonly ArchFinding[];
  readonly known: number;
  readonly fixed: number;
  readonly adopted: number;
}

export interface RatchetInput {
  readonly runtime: Runtime;
  readonly paths: FmPaths;
  readonly root: AbsolutePath;
  readonly git: Git;
  readonly base: string;
  readonly config: ArchConfig;
  readonly tree: SourceTree;
}

const adopt = (input: RatchetInput, baseline: Baseline): { readonly baseline: Baseline; readonly count: number } => {
  const marked = input.runtime.stat(input.paths.cache(ADOPTED_MARKER)) !== undefined;
  if (marked || baseline.entries.some((entry) => entry.check === ARCH_CHECK)) return { baseline, count: 0 };
  const now = input.runtime.now();
  const existing = archFindings(input.config, baseTree(input.git, input.base));
  input.runtime.mkdir(input.paths.dir);
  input.runtime.writeText(input.paths.cache(ADOPTED_MARKER), `${now}\n`);
  return {
    baseline: { ...baseline, entries: [...baseline.entries, ...existing.map((item) => adoptionEntry(item, now))] },
    count: existing.length,
  };
};

export const archRatchet = (input: RatchetInput): ArchRatchet | undefined => {
  const loaded = loadBaseline(input.runtime, input.root);
  if (!loaded.ok) return undefined;
  const adopted = adopt(input, loaded.value);
  const findings = archFindings(input.config, input.tree);
  const result = ratchetFor(ARCH_CHECK, findings, adopted.baseline, input.runtime.now(), () => true);
  const next = withoutFixed(adopted.baseline, result.fixed);
  if (adopted.count > 0 || result.fixed.length > 0) saveBaseline(input.runtime, input.root, next);
  return {
    fresh: [...result.fresh, ...result.expired],
    known: result.known.length,
    fixed: result.fixed.length,
    adopted: adopted.count,
  };
};
