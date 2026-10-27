import { relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import type { YamlValue } from "../core/yaml/scalar.js";
import { gitAt, gitRoot } from "../gate/git.js";
import type { Translate } from "../i18n/translate.js";
import { findByKind, nextNumber, PLAN_DIR, planDir, planFiles, planPath, slugOf } from "../plan/folder.js";
import { readFront, writeFront } from "../plan/front.js";
import { incidentsDir } from "../secrets/incidents.js";
import { linesOf, pathspecOf, resolveCommit } from "./grep.js";
import { readRepo } from "./read.js";
import { renderInventory } from "./render.js";
import { reposOf } from "./report.js";
import { type Inventory, INVENTORY_SCHEMA, type RepoRead } from "./types.js";

export interface InventoryRequest {
  readonly topic: string;
  readonly ref: string;
  readonly covered: readonly string[];
  readonly repos: readonly string[];
}

export type InventoryProblem =
  | { readonly kind: "repo"; readonly repo: string }
  | { readonly kind: "ref"; readonly repo: string; readonly ref: string }
  | { readonly kind: "write"; readonly detail: string };

export interface InventoryWritten {
  readonly file: string;
  readonly inventory: Inventory;
}

const readOne = (
  runtime: Runtime,
  root: AbsolutePath,
  dir: string,
  request: InventoryRequest,
): Parsed<RepoRead, InventoryProblem> => {
  const top = gitRoot(gitAt(runtime, toAbsolutePath(dir, root)));
  if (top === undefined) return reject({ kind: "repo", repo: dir });
  const git = gitAt(runtime, top);
  const hash = resolveCommit(git, request.ref);
  if (hash === undefined) return reject({ kind: "ref", repo: dir, ref: request.ref });
  const path = toPosixPath(relative(runtime.realpath(root), runtime.realpath(top))) || ".";
  return accept(readRepo(git, path, request.ref, hash, request.covered));
};

const deltaOf = (
  runtime: Runtime,
  root: AbsolutePath,
  previous: string | undefined,
  repo: RepoRead,
  covered: readonly string[],
): readonly string[] => {
  if (previous === undefined || previous === repo.hash) return [];
  const git = gitAt(runtime, toAbsolutePath(repo.path, root));
  return linesOf(git.out(["diff", "--name-status", previous, repo.hash, "--", ...pathspecOf(covered)]));
};

const frontOf = (inventory: Inventory): YamlValue => ({
  schema: INVENTORY_SCHEMA,
  topic: inventory.topic,
  date: inventory.date,
  repos: inventory.repos.map((repo) => ({ path: repo.path, ref: repo.ref, hash: repo.hash })),
  covered: [...inventory.covered],
});

const assemble = (
  runtime: Runtime,
  root: AbsolutePath,
  request: InventoryRequest,
  repos: readonly RepoRead[],
  previousText: string | undefined,
): Inventory => {
  const previous = previousText === undefined ? [] : reposOf(readFront(previousText).data);
  const main = repos[0];
  const previousHash = previous.find((item) => item.path === main?.path)?.hash;
  const incidents = runtime.listDir(incidentsDir(root));
  return {
    schema: INVENTORY_SCHEMA,
    topic: request.topic,
    date: runtime.now().slice(0, 10),
    covered: request.covered.length === 0 ? ["."] : request.covered,
    repos,
    delta: main === undefined ? [] : deltaOf(runtime, root, previousHash, main, request.covered),
    ...(previousHash === undefined || previousHash === main?.hash ? {} : { previousHash }),
    incidents: incidents.ok ? incidents.value.filter((name) => name.endsWith(".json")) : [],
  };
};

export const runInventory = (
  runtime: Runtime,
  t: Translate,
  root: AbsolutePath,
  request: InventoryRequest,
): Parsed<InventoryWritten, InventoryProblem> => {
  const reads = (request.repos.length === 0 ? ["."] : request.repos).map((dir) => readOne(runtime, root, dir, request));
  const repos: RepoRead[] = [];
  for (const read of reads) {
    if (!read.ok) return read;
    repos.push(read.value);
  }
  const names = planFiles(runtime, root);
  const name = findByKind(names, "today", request.topic) ?? `${nextNumber(names)}a-today-${slugOf(request.topic)}.md`;
  const target = planPath(root, name);
  const before = runtime.readText(target);
  const inventory = assemble(runtime, root, request, repos, before.ok ? before.value : undefined);
  const made = runtime.mkdir(planDir(root));
  const written = made.ok
    ? runtime.writeText(target, writeFront(frontOf(inventory), renderInventory(t, inventory)))
    : made;
  if (!written.ok) return reject({ kind: "write", detail: written.error });
  return accept({ file: `${PLAN_DIR}/${name}`, inventory });
};
