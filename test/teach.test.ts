import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { readConceptEvents } from "../src/conceitos/evidence.js";
import { proposeProbe } from "../src/conceitos/probes-run.js";
import { classify } from "../src/conceitos/trajectory-splits.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { writeGateStatus } from "../src/gate/hooks/status.js";
import type { HookDecision } from "../src/hooks/handlers.js";
import { createTranslator } from "../src/i18n/translate.js";
import { conceptBand } from "../src/judge/band.js";
import { appendEntry, readEntries } from "../src/judge/store.js";
import { fmPaths } from "../src/task/paths.js";
import { answerQuestion, askQuestion, explain, type TeachDeps } from "../src/teach/flow.js";
import { keyedQuestion, sameAnswer } from "../src/teach/key.js";
import { probeAtClose, teachPause } from "../src/teach/pause.js";
import { readTeach } from "../src/teach/store.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const DOUBLE = 'const n = Number(require("node:fs").readFileSync(0, "utf8").trim());\nconsole.log(String(n * 2));\n';
const CONTRACT =
  "id: twice\ngoal: double a number\nacceptance:\n  - id: C1\n    check: command\n    run: node src/double.js --version\n";
const OPT_IN = "guards:\n  teach-back: active\n  behavior-contract: active\n";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const ticking = (): Runtime => {
  const base = repoRuntime();
  let at = Date.parse("2026-10-01T10:00:00.000Z");
  return {
    ...base,
    now: () => {
      at += 60_000;
      return new Date(at).toISOString();
    },
  };
};

const project = async (policy = OPT_IN): Promise<{ repo: TempRepo; deps: TeachDeps }> => {
  const repo = tempRepo({ "src/double.js": DOUBLE });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", policy);
  trustContract(repo.root, "twice", CONTRACT);
  const opts = { cwd: repo.root, runtime: repoRuntime() };
  const example = ["--says", "twice 21", "--run", "node src/double.js", "--input", "21", "--expect", "42"];
  await cliJson(["task", "examples", "twice", ...example], opts);
  await cliJson(["task", "examples", "twice", "--approve", "E1"], opts);
  return { repo, deps: { runtime: ticking(), paths: fmPaths(repo.root) } };
};

const doubling = (base: Runtime): Runtime => ({
  ...base,
  exec: (request: ExecRequest) => ({
    ...base.exec({ ...request, command: "node", args: ["-e", "process.stdout.write('x')"], shell: false }),
    found: true,
    timedOut: false,
    exitCode: 0,
    stdout: String(Number(request.input ?? "0") * 2),
  }),
});

const answerOnce = (deps: TeachDeps, concept: string, value: string): boolean => {
  const asked = askQuestion(deps, { concepts: [concept], origin: "predict" });
  assert.ok(asked.ok);
  const answered = answerQuestion(deps, asked.view.question, value);
  assert.ok(answered.ok);
  return answered.view.correct === true;
};

describe("teach-back keyed by execution", () => {
  it("takes the answer key from running the code and ignores a key proposed by a fake model", () => {
    const runtime = doubling(repoRuntime());
    const root = toAbsolutePath(process.cwd());
    const proposer = () => ({ input: "3", expected: "999" });
    const keyed = keyedQuestion(runtime, root, { run: "node double.js", input: "21" }, ["math"], proposer);
    assert.deepEqual(keyed, { run: "node double.js", input: "3", key: "6", inputFrom: "provider" });
    const plain = keyedQuestion(runtime, root, { run: "node double.js", input: "21" }, ["math"]);
    assert.equal(plain?.key, "42");
    assert.equal(plain.inputFrom, "template");
  });

  it("compares an open numeric prediction within the tolerance of the numbers check", () => {
    const fixtures: readonly (readonly [string, string, boolean])[] = [
      ["42", "42", true],
      ["42.0", "42", true],
      ["1,000", "1000", true],
      ["  refund 50 to card ", "refund 50 to card", true],
      ["41", "42", false],
      ["4.2", "42", false],
      ["0.30", "0.3", true],
      ["12.5%", "12.5", true],
      ["3.14", "3.15", false],
      ["ok", "fail", false],
    ];
    for (const [answer, key, same] of fixtures) assert.equal(sameAnswer(answer, key), same, `${answer} vs ${key}`);
  });

  it("moves a concept to demonstrated after three keyed correct answers and not after one", async () => {
    const { deps } = await project();
    assert.equal(answerOnce(deps, "backend/integration/webhook", "42"), true);
    assert.notEqual(
      conceptBand("backend/integration/webhook", readEntries(deps.runtime, deps.paths)).band,
      "demonstrated",
    );
    assert.equal(conceptBand("backend/integration/webhook", readEntries(deps.runtime, deps.paths)).band, "no record");
    assert.equal(answerOnce(deps, "backend/integration/webhook", "42.0"), true);
    assert.equal(answerOnce(deps, "backend/integration/webhook", "42"), true);
    assert.equal(
      conceptBand("backend/integration/webhook", readEntries(deps.runtime, deps.paths)).band,
      "demonstrated",
    );
  });

  it("a keyed teach-back answer is recorded as an explanation right or wrong for the proximal split", async () => {
    const { deps } = await project();
    assert.equal(answerOnce(deps, "backend/integration/webhook", "42"), true);
    assert.equal(answerOnce(deps, "backend/integration/webhook", "41"), false);
    const events = readConceptEvents(deps.runtime, deps.paths);
    assert.deepEqual(
      events.map((event) => [event.concept, event.kind, event.origin]),
      [
        ["backend/integration/webhook", "explanation_right", "person"],
        ["backend/integration/webhook", "explanation_wrong", "person"],
      ],
    );
    assert.deepEqual(
      classify(events).map((item) => item.side),
      ["explains"],
    );
  });

  it("stores an explanation and never changes a band with it", async () => {
    const { deps } = await project();
    assert.equal(answerOnce(deps, "backend/integration/webhook", "40"), false);
    const before = conceptBand("backend/integration/webhook", readEntries(deps.runtime, deps.paths));
    assert.ok(explain(deps, ["backend/integration/webhook"], "it doubles the number it reads", "terminal"));
    assert.deepEqual(conceptBand("backend/integration/webhook", readEntries(deps.runtime, deps.paths)), before);
    assert.ok(readTeach(deps.runtime, deps.paths).some((entry) => entry.type === "explanation"));
  });

  it("asks at the edge only and asks nothing when there is no key", async () => {
    const { deps } = await project();
    assert.deepEqual(askQuestion(deps, { concepts: ["backend/integration/webhook"], origin: "edge" }), {
      ok: false,
      reason: "not_at_edge",
    });
    appendEntry(deps.runtime, deps.paths, {
      at: deps.runtime.now(),
      type: "evidence",
      id: "e-own",
      concepts: ["backend/integration/webhook"],
      proof: "own-change",
      result: "pass",
      ref: "commit:abc",
      origin: "person",
    });
    assert.equal(askQuestion(deps, { concepts: ["backend/integration/webhook"], origin: "edge" }).ok, true);
    const bare = tempRepo({ "README.md": "app\n" });
    repos.push(bare);
    const none = askQuestion(
      { runtime: ticking(), paths: fmPaths(bare.root) },
      { concepts: ["backend/integration/webhook"], origin: "know" },
    );
    assert.deepEqual(none, { ok: false, reason: "no_key" });
    assert.deepEqual(readTeach(repoRuntime(), fmPaths(bare.root)), []);
  });

  it("needs the opt-in and refuses an answer typed from inside the agent session", async () => {
    const { repo } = await project("guards:\n  behavior-contract: active\n");
    const refused = await cliJson(["teach"], { cwd: repo.root, runtime: repoRuntime() });
    assert.notEqual(refused.code, 0);
    write(repo.root, ".finitemonkey/policy.yml", OPT_IN);
    const asked = await cliJson(["teach", "ask", "--concepts", "backend/integration/webhook"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    const id = String(field(asked.body, "data", "question", "question"));
    assert.equal(field(asked.body, "data", "question", "input"), "21");
    assert.equal(field(asked.body, "data", "question", "actual"), undefined);
    const answered = await cliJson(["teach", "answer", id, "42"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(answered.body, "error", "code"), "needs_confirmation");
  });
});

const pause = (deps: TeachDeps, session: string): Promise<HookDecision> => {
  writeGateStatus(deps.runtime as Runtime, deps.paths, { status: "passed", task: "twice", detail: "" });
  return Promise.resolve(
    teachPause({
      event: "Stop",
      cwd: deps.paths.root,
      runtime: deps.runtime as Runtime,
      t: createTranslator("en"),
      env: {},
      payload: { hookEventName: "Stop", sessionId: session, cwd: deps.paths.root, stopHookActive: false, raw: {} },
    }),
  );
};

const message = (decision: HookDecision): string => {
  const text = field(decision.output, "systemMessage");
  return typeof text === "string" ? text : "";
};

describe("probes at natural pauses", () => {
  it("fires a probe at a gate pass and stays within the probe budget across sessions", async () => {
    const { deps } = await project();
    const runtime = deps.runtime as Runtime;
    for (const index of [1, 2, 3, 4])
      proposeProbe(runtime, deps.paths, {
        kind: "language",
        concept: "backend/integration/webhook",
        question: `What does webhook ${String(index)} mean here?`,
        why: "the change adds a webhook",
        options: [
          { id: "a", text: "a call the provider makes to us" },
          { id: "b", text: "a call we make to the provider" },
        ],
      });
    const first = message(await pause(deps, "s1"));
    assert.match(first, /P1/);
    assert.match(message(await pause(deps, "s1")), /P1/);
    await cliJson(["probe", "answer", "P1", "a"], { cwd: deps.paths.root, runtime: repoRuntime() });
    assert.doesNotMatch(message(await pause(deps, "s1")), /P2/);
    const shown = [message(await pause(deps, "s2")), message(await pause(deps, "s3"))];
    assert.match(shown[0] ?? "", /P2/);
    assert.doesNotMatch(shown[1] ?? "", /P3/);
    await cliJson(["probe", "answer", "P2", "a"], { cwd: deps.paths.root, runtime: repoRuntime() });
    assert.equal(message(await pause(deps, "s4")), "");
  });

  it("fires the pending probe when the task is closed, once per gate pass", async () => {
    const { deps } = await project();
    const runtime = deps.runtime as Runtime;
    proposeProbe(runtime, deps.paths, {
      kind: "language",
      concept: "backend/integration/webhook",
      question: "What does the webhook mean here?",
      why: "the change adds a webhook",
      options: [
        { id: "a", text: "a call the provider makes to us" },
        { id: "b", text: "a call we make to the provider" },
      ],
    });
    writeGateStatus(runtime, deps.paths, { status: "passed", task: "twice", detail: "" });
    const t = createTranslator("en");
    assert.match(probeAtClose(runtime, deps.paths, t).join("\n"), /P1/);
    assert.deepEqual(probeAtClose(runtime, deps.paths, t), []);
  });

  it("says nothing at a pause without the opt-in", async () => {
    const { deps } = await project("guards:\n  behavior-contract: active\n");
    assert.equal(message(await pause(deps, "s1")), "");
  });
});
