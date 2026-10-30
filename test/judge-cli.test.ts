import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { parseRequest } from "../src/judge/request.js";
import { runVerb } from "../src/judge/verbs.js";
import { fmPaths } from "../src/task/paths.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field, ROOT, stdinFrom } from "./support.js";
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

const project = (mode: string): TempRepo => {
  const repo = tempRepo({ "notes/vat.md": NOTE });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", `guards:\n  judge-core: ${mode}\n`);
  return repo;
};

const GOLDEN = join(ROOT, "test", "fixtures", "judge", "classify.json");

describe("judge verbs through every surface", () => {
  it("the CLI, judge call and the engine give byte-identical JSON for the same input", async () => {
    const viaCli = await cliJson(["judge", "classify", "notes/vat.md"], {
      cwd: project("shadow").root,
      runtime: repoRuntime(),
    });
    assert.equal(viaCli.code, 0, viaCli.stdout);
    const request = { verb: "classify", file: "notes/vat.md", text: NOTE };
    const callRepo = project("shadow");
    const viaCall = await cliJson(["judge", "call"], {
      cwd: callRepo.root,
      runtime: repoRuntime(),
      stdin: stdinFrom(JSON.stringify(request)),
    });
    assert.equal(viaCall.code, 0, viaCall.stdout);
    const parsed = parseRequest(request);
    if (parsed === undefined) throw new Error("request");
    const direct = runVerb({ runtime: repoRuntime(), paths: fmPaths(project("shadow").root) }, parsed);
    const cliText = JSON.stringify(field(viaCli.body, "data"));
    assert.equal(JSON.stringify(field(viaCall.body, "data")), cliText);
    assert.equal(JSON.stringify(direct), cliText);
    assert.deepEqual(JSON.parse(readFileSync(GOLDEN, "utf8")), JSON.parse(cliText));
  });

  it("a result with one model-only claim is not done at the gate once judge-core is active", async () => {
    const repo = project("active");
    trustContract(repo.root, "t", CONTRACT);
    const classified = await cliJson(["judge", "classify", "notes/vat.md", "--task", "t"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(field(classified.body, "data", "result", "done"), false);
    const gate = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime() });
    const items = field(gate.body, "data", "items");
    const judge: unknown = Array.isArray(items) ? items.find((item) => field(item, "id") === "judge") : undefined;
    assert.equal(field(judge, "status"), "unverified");
    assert.equal(field(gate.body, "data", "verdict"), "incomplete");
    assert.equal(field(gate.body, "data", "stateReason"), "unverified:judge(no_verdict)");
  });

  it("concepts for any field follow their own flag", async () => {
    const repo = project("shadow");
    write(repo.root, ".finitemonkey/policy.yml", "guards:\n  judge-core: shadow\n  perfil-any-field: off\n");
    const args = ["judge", "concept", "VAT", "--domain", "tax-law", "--source", "10.1/x", "--span", "the VAT rate"];
    const off = await cliJson(args, { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(off.body, "error", "code"), "judge_refused");
    write(repo.root, ".finitemonkey/policy.yml", "guards:\n  judge-core: shadow\n");
    const on = await cliJson(args, { cwd: repo.root, runtime: repoRuntime() });
    const concepts = field(on.body, "data", "concepts");
    assert.equal(Array.isArray(concepts) ? field(concepts[0], "status") : undefined, "active");
  });

  it("refuses when judge-core is off and lets only the person contest or forget", async () => {
    const off = await cliJson(["judge", "report"], { cwd: project("off").root, runtime: repoRuntime() });
    assert.equal(field(off.body, "error", "code"), "judge_refused");
    const agent = await cliJson(["judge", "forget"], { cwd: project("shadow").root, runtime: repoRuntime() });
    assert.equal(field(agent.body, "error", "code"), "judge_refused");
  });
});
