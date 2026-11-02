import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { domainOf, LEGACY_CONCEPTS } from "../src/conceitos/concepts.js";
import { conceptSummaries, readConceptEvents, recordConceptEvents } from "../src/conceitos/evidence.js";
import { MIGRATED_REF } from "../src/conceitos/judge-log.js";
import { budgetFor, EMPTY_STATE, gapOf } from "../src/conceitos/probes.js";
import { trajectories } from "../src/conceitos/trajectory.js";
import { conceptStates } from "../src/conceitos/xray-run.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { readEntries } from "../src/judge/store.js";
import { DOMAINS } from "../src/perfil/types.js";
import { fmPaths } from "../src/task/paths.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field, ROOT } from "./support.js";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const FIXTURES = join(ROOT, "test", "fixtures", "conceitos");
const LEGACY = readFileSync(join(FIXTURES, "legacy-events.jsonl"), "utf8");
const GOLDEN: unknown = JSON.parse(readFileSync(join(FIXTURES, "views-golden.json"), "utf8"));
const PERFIL = [
  "schema: finitemonkey/perfil@1",
  "updated_at: 2026-10-01T09:00:00.000Z",
  "quick_start: done",
  "domains:",
  "  product: { tool: 50, knowledge: 50 }",
  "  interface: { tool: 55, knowledge: 40 }",
  "  backend: { tool: 72, knowledge: 80, claimed: advanced }",
  "  infrastructure: { tool: 50, knowledge: 30 }",
  "  security: { tool: 50, knowledge: 50 }",
  "",
].join("\n");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const legacyRepo = (): TempRepo => {
  const repo = tempRepo({ "README.md": "hello\n" });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", "guards: {}\n");
  write(repo.root, ".finitemonkey/conceitos-events.jsonl", LEGACY);
  write(repo.root, ".finitemonkey/perfil.yml", PERFIL);
  return repo;
};

const views = (runtime: Runtime, root: string): unknown => {
  const paths = fmPaths(toAbsolutePath(root));
  const events = readConceptEvents(runtime, paths);
  return {
    bands: conceptSummaries(runtime, paths).map((item) => ({
      ...item,
      evidence: item.evidence.map((e) => ({ ...e })),
    })),
    xray: [...conceptStates(runtime, paths)],
    probes: Object.values(LEGACY_CONCEPTS).map((concept) =>
      budgetFor(EMPTY_STATE, { concept, domain: domainOf(concept) }, "s", NOW, events, new Set()),
    ),
    gaps: DOMAINS.map((domain) => gapOf(domain, EMPTY_STATE, events, NOW)),
    trajectory: trajectories(events, [], NOW),
  };
};

const fileText = (root: string, name: string): string => readFileSync(join(root, ".finitemonkey", name), "utf8");

const exists = (root: string, name: string): boolean => {
  try {
    readFileSync(join(root, ".finitemonkey", name));
    return true;
  } catch {
    return false;
  }
};

describe("judge views: profile, concepts, x-ray, probes and trajectory read the one log", () => {
  it("every band, x-ray grid, probe budget and trajectory series is identical before and after migration", async () => {
    const repo = legacyRepo();
    const runtime = repoRuntime();
    const before = views(runtime, repo.root);
    assert.deepEqual(JSON.parse(JSON.stringify(before)), GOLDEN);
    const migrated = await cliJson(["conceitos", "migrate"], { cwd: repo.root, runtime });
    assert.equal(migrated.code, 0, migrated.stdout);
    assert.equal(field(migrated.body, "data", "converted"), true);
    assert.deepEqual(views(runtime, repo.root), before);
    const entries = readEntries(runtime, fmPaths(toAbsolutePath(repo.root)));
    assert.equal(entries.filter((entry) => entry.type === "evidence" && entry.ref === MIGRATED_REF).length, 22);
    assert.equal(fileText(repo.root, "conceitos-events.jsonl"), LEGACY);
    const again = await cliJson(["conceitos", "migrate"], { cwd: repo.root, runtime });
    assert.equal(field(again.body, "data", "converted"), false);
    assert.deepEqual(field(again.body, "data", "files"), []);
  });

  it("the dry run lists every file it would convert and changes nothing", async () => {
    const repo = legacyRepo();
    const runtime = repoRuntime();
    const run = await cliJson(["conceitos", "migrate", "--dry-run"], { cwd: repo.root, runtime });
    assert.equal(run.code, 0, run.stdout);
    assert.deepEqual(field(run.body, "data", "files"), [
      { file: ".finitemonkey/conceitos-events.jsonl", entries: 22 },
      { file: ".finitemonkey/perfil.yml", entries: 6 },
    ]);
    assert.equal(field(run.body, "data", "converted"), false);
    assert.equal(exists(repo.root, "judge.jsonl"), false);
    assert.equal(exists(repo.root, "derived.json"), false);
    assert.equal(fileText(repo.root, "conceitos-events.jsonl"), LEGACY);
    assert.equal(fileText(repo.root, "perfil.yml"), PERFIL);
  });

  it("new evidence goes to the judge log and keeps its place after older events are migrated", async () => {
    const repo = legacyRepo();
    const runtime = repoRuntime();
    const paths = fmPaths(toAbsolutePath(repo.root));
    recordConceptEvents(runtime, paths, [{ concept: "webhook", kind: "own_change", origin: "person", task: "t9" }]);
    assert.equal(fileText(repo.root, "conceitos-events.jsonl"), LEGACY);
    const before = views(runtime, repo.root);
    assert.equal(readConceptEvents(runtime, paths).length, 23);
    await cliJson(["conceitos", "migrate"], { cwd: repo.root, runtime });
    assert.deepEqual(views(runtime, repo.root), before);
    assert.equal(readConceptEvents(runtime, paths).at(-1)?.task, "t9");
  });

  it("forgetting the trajectory drops the concept evidence from the judge log", async () => {
    const repo = legacyRepo();
    const runtime = repoRuntime();
    await cliJson(["conceitos", "migrate"], { cwd: repo.root, runtime });
    const forgot = await cliJson(["trajectory", "forget"], { cwd: repo.root, runtime });
    assert.equal(forgot.code, 0, forgot.stdout);
    assert.deepEqual(readConceptEvents(runtime, fmPaths(toAbsolutePath(repo.root))), []);
  });
});
