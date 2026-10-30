import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { HookInput } from "../src/hooks/handlers.js";
import { EMPTY_PAYLOAD } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { gitignoreBlock } from "../src/install/gitignore-block.js";
import { parseRequest } from "../src/judge/request.js";
import { appendEntry } from "../src/judge/store.js";
import { TRIAGE_HANDLERS, triageAfterWrite } from "../src/judge/triage-hook.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { withPolicy } from "../src/policy/guards.js";
import { fmPaths } from "../src/task/paths.js";
import { git, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const REPORT = [
  "The reduced VAT rate for e-books in Germany is 7%.",
  "Registration in the OSS scheme takes 10 working days.",
  "",
].join("\n");

interface World {
  readonly repo: TempRepo;
  readonly deps: JudgeDeps;
}

const world = (policy = "guards:\n  judge-core: shadow\n  triage: active\n"): World => {
  const repo = tempRepo({ "README.md": "hello\n" });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", policy);
  return { repo, deps: { runtime: repoRuntime(), paths: fmPaths(repo.root) } };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const beyond = (w: World): void => {
  const concept = call(w.deps, { verb: "concept", label: "VAT", domain: "tax-law", source: "10.1/x", span: "VAT" });
  appendEntry(w.deps.runtime, w.deps.paths, {
    type: "evidence",
    id: "e-fail",
    at: w.deps.runtime.now(),
    concepts: [concept.entry],
    proof: "failure-after-acceptance",
    result: "fail",
    ref: "r1",
    origin: "person",
  });
};

const written = (w: World, file: string, content: string): HookInput => ({
  event: "PostToolUse",
  payload: {
    ...EMPTY_PAYLOAD,
    raw: { tool_name: "Write", tool_input: { file_path: join(w.repo.root, file), content } },
  },
  cwd: w.repo.root,
  runtime: repoRuntime(),
  t: createTranslator("en"),
  env: {},
});

describe("triage before a result is used", () => {
  it("writing a result with a model-only claim on a beyond concept into a document lists it", async () => {
    const w = world();
    beyond(w);
    call(w.deps, { verb: "classify", file: "notes/vat.md", text: REPORT });
    const decision = await triageAfterWrite(written(w, "docs/report.md", `# Report\n\n${REPORT}`));
    const reason = decision.kind === "block" ? decision.reason : "";
    assert.match(reason, /The reduced VAT rate for e-books in Germany is 7%/);
    assert.match(reason, /judge verify/);
    const shadow = world("guards:\n  judge-core: shadow\n");
    beyond(shadow);
    call(shadow.deps, { verb: "classify", file: "notes/vat.md", text: REPORT });
    const governed = withPolicy({ id: "triage", damage: false, handlers: TRIAGE_HANDLERS }).PostToolUse?.[0];
    const quiet = await governed?.(written(shadow, "docs/report.md", REPORT));
    assert.equal(quiet?.kind, "allow");
  });

  it("handoff writes the package and keeps the claim out of done", () => {
    const w = world();
    const result = call(w.deps, { verb: "classify", file: "notes/vat.md", text: REPORT }).result;
    const claim = result?.rows[0]?.claim ?? "";
    const handed = call(w.deps, { verb: "handoff", claim, to: "tax advisor", missing: "the rate table for 2026" });
    assert.equal(handed.handoff?.to, "tax advisor");
    assert.ok(existsSync(join(w.repo.root, ".finitemonkey", "judge", "handoffs", `${claim}.json`)));
    const after = call(w.deps, { verb: "classify", file: "notes/vat.md", text: REPORT }).result;
    assert.equal(after?.handedOff, 1);
    assert.equal(after.done, false);
  });

  it("asks at most one question per task, and only when a decision record depends on it", () => {
    const w = world();
    const ask = {
      verb: "ask",
      task: "t1",
      decision: "docs/plan/04-decision-vat.md",
      question: "Is 7% right?",
      criterion: "the rate table",
    };
    assert.equal(call(w.deps, ask).reason, "no_decision");
    write(w.repo.root, "docs/plan/04-decision-vat.md", "# Decision\n");
    assert.equal(call(w.deps, ask).ok, true);
    assert.equal(call(w.deps, { ...ask, question: "And the threshold?" }).reason, "one_per_task");
  });

  it("caps triage flags per task", async () => {
    const w = world();
    beyond(w);
    const flags: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const text = `The VAT rate number ${String(index)} is ${String(10 + index)}%.\n`;
      call(w.deps, { verb: "classify", file: `notes/${String(index)}.md`, text });
      const decision = await triageAfterWrite(written(w, `docs/${String(index)}.md`, text));
      flags.push(decision.kind);
    }
    assert.deepEqual(flags, ["block", "block", "block", "allow", "allow"]);
    const repeat = await triageAfterWrite(written(w, "docs/again.md", "The VAT rate number 0 is 10%.\n"));
    assert.equal(repeat.kind, "allow");
  });

  it("nothing in the triage list or the package enters a commit", () => {
    const w = world();
    write(w.repo.root, ".gitignore", `${gitignoreBlock().join("\n")}\n`);
    const result = call(w.deps, { verb: "classify", file: "notes/vat.md", text: REPORT }).result;
    call(w.deps, { verb: "handoff", claim: result?.rows[0]?.claim, to: "advisor", missing: "rates" });
    git(w.repo.root, "add", "-A");
    const staged = git(w.repo.root, "diff", "--cached", "--name-only");
    assert.ok(!staged.includes(".finitemonkey/judge"), staged);
    assert.ok(existsSync(toAbsolutePath(join(w.repo.root, ".finitemonkey", "judge.jsonl"))));
  });
});
