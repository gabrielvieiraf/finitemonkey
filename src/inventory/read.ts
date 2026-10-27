import type { Git } from "../gate/git.js";
import { maskText } from "../mask/mask.js";
import { scanText } from "../secrets/engine.js";
import { dependenciesAt } from "./dependencies.js";
import { filesAt, grepAt, linesOf, pathspecOf } from "./grep.js";
import { CREDENTIAL_HINTS, DEPLOY_FILE, ENV, envNamesIn, JOBS, QUEUES, ROUTES, TABLES, TEST_FILE } from "./patterns.js";
import type { CredentialHit, EnvName, Hit, Hotspot, Module, RepoRead } from "./types.js";

const MAX_TEXT = 120;
const HOTSPOT_COMMITS = 300;
const MAX_HOTSPOTS = 10;

const where = (hit: Pick<Hit, "file" | "line">): string => `${hit.file}:${String(hit.line)}`;

const shown = (hits: readonly Hit[]): readonly Hit[] =>
  hits.map((hit) => ({ ...hit, text: maskText(hit.text).slice(0, MAX_TEXT) }));

const moduleOf = (file: string): string => {
  const parts = file.split("/");
  return parts.length <= 1 ? "." : parts.slice(0, Math.min(2, parts.length - 1)).join("/");
};

const modulesOf = (files: readonly string[]): readonly Module[] => {
  const counts = new Map<string, number>();
  for (const file of files.filter((item) => !TEST_FILE.test(item))) {
    counts.set(moduleOf(file), (counts.get(moduleOf(file)) ?? 0) + 1);
  }
  return [...counts].map(([path, count]) => ({ path, files: count })).sort((a, b) => a.path.localeCompare(b.path));
};

const envOf = (hits: readonly Hit[]): readonly EnvName[] => {
  const names = new Map<string, string[]>();
  for (const hit of hits) {
    for (const name of envNamesIn(hit.text)) names.set(name, [...(names.get(name) ?? []), where(hit)]);
  }
  return [...names].map(([name, at]) => ({ name, at: [...new Set(at)] })).sort((a, b) => a.name.localeCompare(b.name));
};

const credentialsOf = (hits: readonly Hit[]): readonly CredentialHit[] =>
  hits.flatMap((hit) =>
    scanText(hit.text, { path: hit.file }).map((finding) => ({ at: where(hit), rule: finding.ruleId })),
  );

const hotspotsOf = (git: Git, hash: string, covered: readonly string[]): readonly Hotspot[] => {
  const out = git.out([
    "log",
    "--format=",
    "--name-only",
    "-n",
    String(HOTSPOT_COMMITS),
    hash,
    "--",
    ...pathspecOf(covered),
  ]);
  const counts = new Map<string, number>();
  for (const file of linesOf(out)) counts.set(file, (counts.get(file) ?? 0) + 1);
  return [...counts]
    .map(([path, changes]) => ({ path, changes }))
    .filter((item) => item.changes > 1)
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, MAX_HOTSPOTS);
};

const worktreesOf = (git: Git): readonly string[] => {
  const paths = linesOf(git.out(["worktree", "list", "--porcelain"]))
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  return paths.length > 1 ? paths : [];
};

export const readRepo = (git: Git, path: string, ref: string, hash: string, covered: readonly string[]): RepoRead => {
  const files = filesAt(git, hash, covered);
  return {
    path,
    hash,
    ref,
    modules: modulesOf(files),
    routes: shown(grepAt(git, hash, ROUTES, covered)),
    tables: shown(grepAt(git, hash, TABLES, covered)),
    queues: shown(grepAt(git, hash, QUEUES, covered)),
    jobs: shown(grepAt(git, hash, JOBS, covered)),
    env: envOf(grepAt(git, hash, ENV, covered)),
    dependencies: dependenciesAt(git, hash, files),
    tests: files.filter((file) => TEST_FILE.test(file)),
    credentials: credentialsOf(grepAt(git, hash, CREDENTIAL_HINTS, covered)),
    deploy: files.filter((file) => DEPLOY_FILE.test(file)),
    hotspots: hotspotsOf(git, hash, covered),
    worktrees: worktreesOf(git),
  };
};
