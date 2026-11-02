import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { readLedger } from "../src/evidence/ledger.js";
import { readEntries } from "../src/judge/store.js";
import { profileFromLog, renderProfile } from "../src/perfil/log.js";
import { profileOrStart, readProfile, updateDomain, writeProfile } from "../src/perfil/store.js";
import { fmPaths } from "../src/task/paths.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const NOTE = [
  "# VAT on digital services",
  "",
  "The standard rate is 20% for digital services sold to consumers.",
  "The rule applies from 1 January 2021 because the directive was transposed then.",
  "",
].join("\n");

const CONTRACT = [
  "id: t",
  "goal: research the VAT rule",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node --version",
  "",
].join("\n");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (guards: string): TempRepo => {
  const repo = tempRepo({ "notes/vat.md": NOTE });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", `guards:\n${guards}`);
  return repo;
};

const judgeItem = (body: unknown): unknown => {
  const items = field(body, "data", "items");
  return Array.isArray(items) ? items.find((item) => field(item, "id") === "judge") : undefined;
};

describe("judge views: perfil.yml and the task ledger", () => {
  it("perfil.yml is rebuilt from the log and a hand edit is reported", async () => {
    const repo = project("  derived-cache: active\n");
    const runtime = repoRuntime();
    const paths = fmPaths(toAbsolutePath(repo.root));
    const profile = updateDomain(profileOrStart(runtime, paths), "backend", (entry) => ({ ...entry, knowledge: 80 }));
    assert.equal(writeProfile(runtime, paths, profile), true);
    const logged = profileFromLog(readEntries(runtime, paths));
    assert.ok(logged);
    assert.equal(logged.domains.backend.knowledge, 80);
    const file = join(repo.root, ".finitemonkey", "perfil.yml");
    const rendered = renderProfile(logged);
    assert.equal(readFileSync(file, "utf8"), rendered);
    writeFileSync(file, rendered.replace("knowledge: 80", "knowledge: 95"));
    assert.equal(readProfile(runtime, paths)?.domains.backend.knowledge, 80);
    const shown = await cli(["perfil"], { cwd: repo.root, runtime });
    assert.equal(shown.code, 0, shown.stderr);
    assert.match(shown.stdout, /perfil\.yml was edited by hand.*knowledge: 95/);
    assert.equal(readFileSync(file, "utf8"), rendered);
  });

  it("a task ledger entry carries the content hash of a source it used", async () => {
    const repo = project("  judge-core: active\n");
    trustContract(repo.root, "t", CONTRACT);
    const runtime = repoRuntime();
    await cliJson(["judge", "classify", "notes/vat.md", "--task", "t"], { cwd: repo.root, runtime });
    const result = readEntries(runtime, fmPaths(toAbsolutePath(repo.root))).find((entry) => entry.type === "result");
    assert.ok(result?.type === "result");
    await cliJson(["gate"], { cwd: repo.root, runtime });
    const ledger = readLedger(runtime, fmPaths(toAbsolutePath(repo.root)).evidence("t"));
    const judge = ledger.findLast((entry) => entry.check === "judge");
    assert.ok(judge?.sources?.some((source) => source.ref === result.source && source.hash === result.hash));
  });

  it("the model-only rule runs at the gate with judge-core off, and only the flag decides whether it holds", async () => {
    const repo = project("  judge-core: shadow\n");
    trustContract(repo.root, "t", CONTRACT);
    const runtime = repoRuntime();
    await cliJson(["judge", "classify", "notes/vat.md", "--task", "t"], { cwd: repo.root, runtime });
    write(repo.root, ".finitemonkey/policy.yml", "guards:\n  judge-core: off\n");
    const gate = await cliJson(["gate"], { cwd: repo.root, runtime });
    const judge = judgeItem(gate.body);
    assert.equal(field(judge, "status"), "passed", gate.stdout);
    assert.match(JSON.stringify(judge), /gate\.judge\.shadow.*gate\.judge\.model_only/);
  });
});
