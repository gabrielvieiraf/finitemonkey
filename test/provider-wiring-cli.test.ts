import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import type { ProviderKind } from "../src/provider/kinds.js";
import { tty } from "./guardian-support.js";
import { answer, claudeExec, type FakeClaude, providerJson, world } from "./provider-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const CONTRACT = [
  "id: coupons",
  "goal: apply coupons at checkout",
  "scope:",
  "  paths: [src/]",
  "acceptance:",
  "  - id: coupon-math",
  "    check: command",
  "    run: npm test",
  "",
].join("\n");

const PREMISE = "an expired coupon is rejected | impact: high | verify: behavior";
const FILE = "test/an-expired-coupon-is-rejected.negative.test.ts";

const setup = (kinds: readonly ProviderKind[]): Repo => {
  const repo = makeRepo({
    ".finitemonkey/tasks/coupons.yml": CONTRACT,
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "coupons", done: [] }),
    ".finitemonkey/policy.yml": "guards:\n  model-provider: active\n",
    ".finitemonkey/provider.json": providerJson(kinds),
    "src/coupon.ts": "export const apply = (total: number): number => total;\n",
  });
  repos.push(repo);
  return repo;
};

const withClaude = (calls: ExecRequest[], fake: FakeClaude | undefined): Runtime => {
  const base = repoRuntime();
  const claude = claudeExec(calls, fake);
  return { ...base, exec: (request) => claude(request) ?? base.exec(request) };
};

describe("provider enable prints what each new kind sends", () => {
  it("names the data each new kind sends before the yes", async () => {
    const w = world();
    const sends: Readonly<Record<string, RegExp>> = {
      "code-concepts": /added lines/,
      "negative-test": /behavior premise/,
      "teach-input": /answer key still comes only from running/,
      journey: /sentence/,
    };
    for (const [kind, pattern] of Object.entries(sends)) {
      const text = await cli(["provider", "enable", kind], { cwd: w.paths.root, runtime: w.runtime, stdin: tty() });
      assert.match(text.stdout, pattern);
    }
  });
});

describe("commands call their proposer only when the kind is on", () => {
  it("guardian assume test shows a fuller test and writes it only for the person with its hash", async () => {
    const repo = setup(["negative-test"]);
    const calls: ExecRequest[] = [];
    const runtime = withClaude(calls, { answer: answer({ content: "it('rejects', () => {});\n" }) });
    await cli(["guardian", "assume", "add", PREMISE], { cwd: repo.root, runtime });
    const shown = await cliJson(["guardian", "assume", "test", "a1"], { cwd: repo.root, runtime });
    const hash = String(field(shown.body, "data", "fuller", "hash"));
    assert.equal(field(shown.body, "data", "fuller", "origin"), "model-proposed");
    assert.equal(existsSync(join(repo.root, FILE)), false);
    const agent = await cliJson(["guardian", "assume", "test", "a1", "--write", "--fuller", hash], {
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
      stdin: tty(),
      runtime,
    });
    assert.notEqual(agent.code, 0);
    const wrong = await cliJson(["guardian", "assume", "test", "a1", "--write", "--fuller", "bad"], {
      cwd: repo.root,
      stdin: tty(),
      runtime,
    });
    assert.notEqual(wrong.code, 0);
    assert.equal(existsSync(join(repo.root, FILE)), false);
    const calledBefore = calls.length;
    const person = await cliJson(["guardian", "assume", "test", "a1", "--write", "--fuller", hash], {
      cwd: repo.root,
      stdin: tty(),
      runtime,
    });
    assert.equal(person.code, 0, person.stdout);
    assert.equal(repo.read(FILE), "it('rejects', () => {});\n");
    assert.equal(calls.length, calledBefore);
  });

  it("with no kind on, the commands spawn no claude and keep their old behavior", async () => {
    const repo = setup([]);
    const calls: ExecRequest[] = [];
    const runtime = withClaude(calls, { answer: answer({ steps: [] }) });
    await cli(["guardian", "assume", "add", PREMISE], { cwd: repo.root, runtime });
    const shown = await cliJson(["guardian", "assume", "test", "a1"], { cwd: repo.root, runtime });
    assert.equal(field(shown.body, "data", "fuller"), undefined);
    const journey = await cliJson(["journey", "propose", "checkout", "--says", "a buyer opens the cart"], {
      cwd: repo.root,
      runtime,
    });
    assert.notEqual(journey.code, 0);
    const pair = await cliJson(["look", "pair", "rank", "a.png", "b.png"], { cwd: repo.root, runtime });
    assert.notEqual(pair.code, 0);
    const horizon = await cliJson(["judge", "horizon", "propose", "--text", "VAT on e-books", "--domain", "tax"], {
      cwd: repo.root,
      runtime,
    });
    assert.deepEqual(field(horizon.body, "data", "horizon"), []);
    assert.deepEqual(calls, []);
  });

  it("journey propose --says uses the provider by default and the configured command as an override", async () => {
    const repo = setup(["journey"]);
    const calls: ExecRequest[] = [];
    const steps = [{ goto: "/cart", expect: { text: "Cart" } }];
    const runtime = withClaude(calls, { answer: answer({ steps }) });
    const made = await cliJson(["journey", "propose", "checkout", "--says", "a buyer opens the cart"], {
      cwd: repo.root,
      runtime,
    });
    assert.equal(made.code, 0, made.stdout);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      (field(made.body, "data", "journeys") as readonly unknown[]).map((item) => field(item, "approved")),
      [false],
    );
    repo.write(".finitemonkey/config.yml", 'journeys:\n  proposer: node -e "process.exit(3)"\n');
    const override = await cliJson(["journey", "propose", "other", "--says", "a buyer pays"], {
      cwd: repo.root,
      runtime,
    });
    assert.notEqual(override.code, 0);
    assert.equal(calls.length, 1);
  });

  it("judge horizon propose shows help from the horizon kind and moves no band", async () => {
    const repo = setup(["horizon"]);
    const calls: ExecRequest[] = [];
    const help = [{ kind: "question", text: "Does the reduced rate cover e-books?", criterion: "none" }];
    const runtime = withClaude(calls, { answer: answer(help) });
    const shown = await cliJson(["judge", "horizon", "propose", "--text", "VAT on e-books", "--domain", "tax"], {
      cwd: repo.root,
      runtime,
    });
    assert.equal(shown.code, 0, shown.stdout);
    const horizon = field(shown.body, "data", "horizon");
    assert.ok(Array.isArray(horizon) && horizon.length === 1);
    assert.equal(field(horizon[0], "state"), "shown");
    assert.equal(calls.length, 1);
  });

  it("research source asks the stance kind for an unconfirmed side, which never counts as one", async () => {
    const repo = setup(["stance"]);
    repo.write("docs/plan/03-decision-vat.md", "# Decision: VAT rate\n");
    const calls: ExecRequest[] = [];
    const runtime = withClaude(calls, { answer: answer({ stance: "favors" }) });
    const unknown = "whether e-books count as books";
    const question = ["research", "new", "is the reduced VAT rate allowed for e-books"];
    await cli([...question, "--decision", "docs/plan/03-decision-vat.md", "--unknown", unknown], {
      cwd: repo.root,
      runtime,
    });
    const slug = "is-the-reduced-vat-rate-allowed-for-e-books";
    const url = "https://taxation.example.eu/ebooks";
    const source = ["research", "source", slug, url, "--changed", "unknown", "--resolves", unknown];
    const added = await cli(source, { cwd: repo.root, runtime });
    assert.equal(added.code, 0, added.stdout + added.stderr);
    assert.match(added.stdout, /suggests the stance favors/);
    const status = await cliJson(["research", "status", slug], { cwd: repo.root, runtime });
    const sides = field(status.body, "data", "sides");
    assert.ok(Array.isArray(sides));
    assert.deepEqual(field(sides[0], "favors"), []);
    assert.deepEqual(field(sides[0], "suggested"), [url]);
    assert.equal(calls.length, 1);
  });

  it("look pair rank records the critic's pick for the person to judge", async () => {
    const repo = setup(["critic"]);
    const calls: ExecRequest[] = [];
    const runtime = withClaude(calls, { answer: answer({ pick: "b" }) });
    const ranked = await cliJson(["look", "pair", "rank", "a.png", "b.png"], { cwd: repo.root, runtime });
    assert.equal(ranked.code, 0, ranked.stdout);
    const pairs = field(ranked.body, "data", "pairs");
    assert.ok(Array.isArray(pairs));
    assert.deepEqual([field(pairs[0], "critic"), field(pairs[0], "person")], ["b", null]);
  });

  it("judge contradict propose lists sources from the model and opens no event", async () => {
    const repo = setup(["claim-contradictions"]);
    repo.write("note.md", "E-books pay the reduced VAT rate in every member state.\n");
    const calls: ExecRequest[] = [];
    const runtime = withClaude(calls, { answer: answer([{ source: "https://eur-lex.europa.eu/x", span: "not" }]) });
    const classified = await cliJson(["judge", "classify", "note.md"], { cwd: repo.root, runtime });
    const rows = field(classified.body, "data", "result", "rows");
    const claim = String(Array.isArray(rows) ? field(rows[0], "claim") : "");
    const proposed = await cliJson(["judge", "contradict", "propose", claim], { cwd: repo.root, runtime });
    assert.equal(proposed.code, 0, proposed.stdout);
    const found = field(proposed.body, "data", "proposedContradictions");
    assert.deepEqual(found, [{ source: "https://eur-lex.europa.eu/x", span: "not", origin: "model-proposed" }]);
    const events = await cliJson(["judge", "trajectory"], { cwd: repo.root, runtime });
    assert.deepEqual(field(events.body, "data", "events"), []);
  });
});
