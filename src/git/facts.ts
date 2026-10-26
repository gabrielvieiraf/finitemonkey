export type DirtyKind = "changed" | "untracked" | "unmerged";

export interface DirtyEntry {
  readonly path: string;
  readonly kind: DirtyKind;
  readonly staged: boolean;
  readonly unstaged: boolean;
}

export interface Upstream {
  readonly branch: string;
  readonly remoteRef: string;
}

export interface GitFacts {
  readonly prefix: string;
  readonly currentBranch: () => string | undefined;
  readonly defaultBranch: () => string;
  readonly isProtected: (branch: string) => boolean;
  readonly dirty: () => readonly DirtyEntry[] | undefined;
  readonly isRef: (name: string) => boolean;
  readonly branchExists: (name: string) => boolean;
  readonly branchContained: (branch: string) => boolean;
  readonly upstream: (branch: string) => Upstream | undefined;
  readonly sharedBranch: (branch: string) => boolean;
}

export const memo = <T>(compute: () => T): (() => T) => {
  let cached: { readonly value: T } | undefined;
  return () => {
    cached ??= { value: compute() };
    return cached.value;
  };
};

export const memoBy = <T>(compute: (key: string) => T): ((key: string) => T) => {
  const cache = new Map<string, { readonly value: T }>();
  return (key) => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit.value;
    const value = compute(key);
    cache.set(key, { value });
    return value;
  };
};

export const STATE_PREFIX = ".finitemonkey/";

const PORCELAIN_FIELDS = { ordinary: 8, renamed: 9, unmerged: 10 } as const;

const entryOf = (kind: DirtyKind, xy: string, path: string): DirtyEntry => ({
  path,
  kind,
  staged: kind !== "untracked" && !xy.startsWith("."),
  unstaged: kind === "untracked" || xy.charAt(1) !== ".",
});

const afterFields = (record: string, count: number): string => record.split(" ").slice(count).join(" ");

export const parsePorcelainV2 = (stdout: string): readonly DirtyEntry[] => {
  const records = stdout.split("\u0000");
  const out: DirtyEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    const xy = record.split(" ")[1] ?? "..";
    if (record.startsWith("1 ")) out.push(entryOf("changed", xy, afterFields(record, PORCELAIN_FIELDS.ordinary)));
    else if (record.startsWith("2 ")) {
      out.push(entryOf("changed", xy, afterFields(record, PORCELAIN_FIELDS.renamed)));
      index += 1;
    } else if (record.startsWith("u ")) {
      out.push(entryOf("unmerged", xy, afterFields(record, PORCELAIN_FIELDS.unmerged)));
    } else if (record.startsWith("? ")) out.push(entryOf("untracked", "??", record.slice(2)));
  }
  return out.filter((entry) => entry.path !== "" && !entry.path.startsWith(STATE_PREFIX));
};
