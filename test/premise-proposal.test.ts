import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { premiseIn } from "../src/premise/detect.js";
import { type CheckDraft, proposeCheck, readProposals, templateCheck } from "../src/premise/proposal.js";
import { fmPaths } from "../src/task/paths.js";
import { fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, parseBody } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const PROMPT = "parseAmount in src/money.ts already handles null, so skip that case";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const setup = (mode = "active"): Repo => {
  const repo = makeRepo({
    ".finitemonkey/policy.yml": policyWith({ "premise-check": mode, "claim-checks": "active" }),
    "src/money.ts": "export const parseAmount = (v: string | null) => (v === null ? 0 : Number(v));\n",
  });
  repos.push(repo);
  return repo;
};

const run = (repo: Repo, args: readonly string[], person: boolean) =>
  cliJson(args, {
    cwd: repo.root,
    runtime: repoRuntime(),
    ...(person ? { stdin: tty() } : { env: { CLAUDECODE: "1" } }),
  });

const noClaims = (repo: Repo): boolean => !existsSync(join(repo.root, ".finitemonkey", "claims.jsonl"));

const firstProposal = (repo: Repo) => readProposals(repoRuntime(), fmPaths(repo.root))[0];

describe("premise check proposals", () => {
  it("drafts a check from the premise's subject", () => {
    const premise = premiseIn(PROMPT);
    assert.ok(premise !== undefined);
    assert.equal(templateCheck(premise)?.run, "git grep -q -w -F -e 'parseAmount' -- 'src/money.ts'");
    const absent = premiseIn("`legacyTotal` is never called anywhere");
    assert.ok(absent !== undefined);
    assert.match(templateCheck(absent)?.run ?? "", /git grep -o -w -F -e 'legacyTotal' \| wc -l\)" -le 1/);
  });

  it("proposes a check on the prompt and runs nothing until a person approves it", async () => {
    const repo = setup();
    const prompted = await fireHook(repo, "UserPromptSubmit", { prompt: PROMPT });
    assert.match(String(parseBody(prompted.stdout)["systemMessage"]), /finitemonkey claims approve p-[0-9a-f]{8}/);
    const proposal = firstProposal(repo);
    assert.ok(proposal !== undefined);
    assert.equal(proposal.state, "proposed");
    assert.ok(noClaims(repo));
    const byAgent = await run(repo, ["claims", "approve", proposal.id], false);
    assert.notEqual(byAgent.code, 0);
    assert.equal(firstProposal(repo)?.state, "proposed");
    assert.ok(noClaims(repo));
    const byPerson = await run(repo, ["claims", "approve", proposal.id], true);
    assert.equal(byPerson.code, 0, byPerson.stdout);
    assert.equal(firstProposal(repo)?.state, "approved");
    const claims = await run(repo, ["claims", "list"], true);
    const list = field(claims.body, "data", "claims");
    const claim: unknown = Array.isArray(list) ? list[0] : undefined;
    assert.equal(field(claim, "kind"), "check");
    assert.equal(field(claim, "status"), "valid");
    assert.match(JSON.stringify(field(claim, "anchors")), /src\/money\.ts/);
  });

  it("never lets a fake model approve its own proposal", () => {
    const repo = setup();
    const premise = premiseIn(PROMPT);
    assert.ok(premise !== undefined);
    const model = (): CheckDraft =>
      Object.assign({ run: "true", symbols: ["parseAmount"], files: ["src/money.ts"] }, { state: "approved" });
    const proposal = proposeCheck(repoRuntime(), fmPaths(repo.root), premise, model);
    assert.equal(proposal?.state, "proposed");
    assert.equal(firstProposal(repo)?.state, "proposed");
    assert.ok(noClaims(repo));
  });

  it("proposes nothing in shadow", async () => {
    const repo = setup("shadow");
    await fireHook(repo, "UserPromptSubmit", { prompt: PROMPT });
    assert.equal(firstProposal(repo), undefined);
  });
});
