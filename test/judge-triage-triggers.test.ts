import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { statusOf } from "../src/bridge/status.js";
import type { HookInput } from "../src/hooks/handlers.js";
import { EMPTY_PAYLOAD } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { parseRequest } from "../src/judge/request.js";
import { appendEntry, readEntries } from "../src/judge/store.js";
import { triageCount } from "../src/judge/triage.js";
import { triageAfterWrite } from "../src/judge/triage-hook.js";
import { triageRecord, triageResearch } from "../src/judge/triage-record.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { bandLine, parseStatus } from "../src/mod/status.js";
import { fmPaths } from "../src/task/paths.js";
import { git, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const REPORT = "The reduced VAT rate for e-books in Germany is 7%.\n";

interface World {
  readonly repo: TempRepo;
  readonly deps: JudgeDeps;
  readonly claim: string;
}

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const world = (policy = "guards:\n  judge-core: shadow\n  triage: active\n"): World => {
  const repo = tempRepo({ "README.md": "hello\n" });
  repos.push(repo);
  write(repo.root, ".fm/policy.yml", policy);
  const deps = { runtime: repoRuntime(), paths: fmPaths(repo.root) };
  const concept = call(deps, { verb: "concept", label: "VAT", domain: "tax-law", source: "10.1/x", span: "VAT" });
  appendEntry(deps.runtime, deps.paths, {
    type: "evidence",
    id: "e-fail",
    at: deps.runtime.now(),
    concepts: [concept.entry],
    proof: "failure-after-acceptance",
    result: "fail",
    ref: "r1",
    origin: "person",
  });
  const claim = call(deps, { verb: "classify", file: "notes/vat.md", text: REPORT }).result?.rows[0]?.claim ?? "";
  appendEntry(deps.runtime, deps.paths, {
    type: "result",
    id: "r-research",
    at: deps.runtime.now(),
    source: "notes/vat.md",
    hash: "h1",
    claims: [claim],
    research: "vat-rate",
  });
  return { repo, deps, claim };
};

const hookInput = (w: World, tool: string, input: Readonly<Record<string, unknown>>): HookInput => ({
  event: "PostToolUse",
  payload: { ...EMPTY_PAYLOAD, raw: { tool_name: tool, tool_input: input } },
  cwd: w.repo.root,
  runtime: repoRuntime(),
  t: createTranslator("en"),
  env: {},
});

const RECORD = JSON.stringify({ schema: "finitemonkey/decision-record@1", task: "t1", research: ["vat-rate"] });

const reasonOf = async (input: HookInput): Promise<string> => {
  const decision = await triageAfterWrite(input);
  return decision.kind === "block" ? decision.reason : "";
};

describe("triage on every trigger it names", () => {
  it("a decision record citing a model-only claim on a beyond concept produces the triage list", async () => {
    const w = world();
    const file = join(w.repo.root, ".fm", "decision-records", "t1.json");
    write(w.repo.root, ".fm/decision-records/t1.json", RECORD);
    const reason = await reasonOf(hookInput(w, "Write", { file_path: file, content: RECORD }));
    assert.match(reason, /This decision record cites 1 claim/);
    assert.match(reason, /The reduced VAT rate for e-books in Germany is 7%/);
  });

  it("the decision record written on close is triaged once, and a second trigger skips the same claim", () => {
    const w = world();
    write(w.repo.root, ".fm/decision-records/t1.json", RECORD);
    assert.deepEqual(
      triageRecord(w.deps.runtime, w.deps.paths, "t1").map((row) => row.claim),
      [w.claim],
    );
    assert.deepEqual(triageResearch(w.deps.runtime, w.deps.paths, "t1", { slug: "vat-rate", claims: [] }), []);
  });

  it("a commit message referencing a result file produces the triage list", async () => {
    const w = world();
    write(w.repo.root, "notes/vat.md", REPORT);
    git(w.repo.root, "add", "notes/vat.md");
    git(w.repo.root, "commit", "-m", "docs: add notes/vat.md with the VAT findings");
    const reason = await reasonOf(hookInput(w, "Bash", { command: 'git commit -m "docs: add notes"' }));
    assert.match(reason, /This commit references results with 1 claim/);
    assert.equal(await reasonOf(hookInput(w, "Bash", { command: "git status" })), "");
  });

  it("closing a research log produces the triage list for the claims it carried", () => {
    const w = world();
    const rows = triageResearch(w.deps.runtime, w.deps.paths, "none", { slug: "vat-rate", claims: [] });
    assert.deepEqual(
      rows.map((row) => row.claim),
      [w.claim],
    );
    assert.deepEqual(triageCount(readEntries(w.deps.runtime, w.deps.paths)), { flagged: 1, open: 1 });
  });

  it("the reality report and the gate band show the triage count from a fixture log", async () => {
    const w = world();
    triageResearch(w.deps.runtime, w.deps.paths, "none", { slug: "vat-rate", claims: [] });
    const report = await cliJson(["guardian", "report"], { cwd: w.repo.root, runtime: repoRuntime() });
    assert.deepEqual(field(report.body, "data", "triage"), { flagged: 1, open: 1 });
    const status = statusOf(repoRuntime(), fmPaths(w.repo.root));
    assert.deepEqual(status.triage, { flagged: 1, open: 1 });
    const view = parseStatus(JSON.stringify(status));
    assert.ok(view !== undefined);
    assert.match(bandLine(view), /triage 1\/1 open/);
  });

  it("nothing is flagged when triage is off", () => {
    const w = world("guards:\n  judge-core: shadow\n  triage: off\n");
    assert.deepEqual(triageResearch(w.deps.runtime, w.deps.paths, "none", { slug: "vat-rate", claims: [] }), []);
  });
});
