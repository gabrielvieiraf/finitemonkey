import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { createTranslator } from "../src/i18n/translate.js";
import { citeVerifier } from "../src/judge/cite.js";
import type { Fetched } from "../src/judge/fetch.js";
import { horizonActed } from "../src/judge/horizon-acted.js";
import { closeHorizon, outcomeMarks } from "../src/judge/horizon-outcome.js";
import { parseRequest } from "../src/judge/request.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { proposeHelps } from "../src/judge/verbs-horizon.js";
import { DEFAULT_VERIFIERS } from "../src/judge/verify.js";
import { blindBand } from "../src/signals/blind-band.js";
import { fmPaths } from "../src/task/paths.js";
import { writeState } from "../src/task/state.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const PAGE = "<p>Under the 2022 directive the reduced rate for e-books is 5%.</p>";

const world = (): JudgeDeps => {
  const fs = memoryFs({ [toAbsolutePath("/home/ana/project/.git/HEAD")]: "ref: refs/heads/main\n" }, [
    toAbsolutePath("/home/ana/project/.finitemonkey"),
  ]);
  return {
    runtime: fakeRuntime({ fs }),
    paths: fmPaths(toAbsolutePath("/home/ana/project")),
    fetcher: (id): Fetched => (id === "10.1000/vat-2022" ? { status: "ok", content: PAGE } : { status: "not-found" }),
    verifiers: { ...DEFAULT_VERIFIERS, "source-span": citeVerifier, prose: citeVerifier },
  };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const help = (deps: JudgeDeps, text: string, extra: Readonly<Record<string, unknown>> = {}) =>
  call(deps, { verb: "horizon", kind: "question", text, domain: "tax-law", task: "t1", ...extra }).horizon?.[0];

describe("horizon help carries the criterion that would answer it", () => {
  it("no help is shown without a criterion field, with none stated when absent", () => {
    const deps = world();
    const shown = proposeHelps(deps, { text: "VAT on e-books", domain: "tax-law", task: "t1" }, () => [
      { kind: "question", text: "Does the reduced rate cover audiobooks?" },
      { kind: "question", text: "Which directive set the e-book rate?", criterion: "source-span" },
      { kind: "concept", text: "place of supply", criterion: "source-span", answer: "10.1000/vat-2022" },
    ]).horizon;
    assert.deepEqual(
      shown?.map((item) => item.criterion),
      ["none", "none", "source-span"],
    );
  });

  it("accepted help with no criterion raises the blind band index for its domain", () => {
    const deps = world();
    const id = help(deps, "Should the shop register for OSS?")?.help;
    const accepted = call(deps, { verb: "accept", help: id });
    assert.deepEqual(
      accepted.horizonDomains?.map((row) => [row.domain, row.acceptedWithoutCriterion, row.index]),
      [["tax-law", 1, 1]],
    );
    const log = deps.runtime.readText(deps.paths.log);
    const band = blindBand(deps.runtime, deps.paths, log.ok ? log.value : "");
    assert.equal(band.total.withoutCriterion, 1);
  });

  it("a dismissed question is counted and not shown again in the same task", () => {
    const deps = world();
    const text = "Is VAT due on free trials?";
    const id = help(deps, text)?.help;
    call(deps, { verb: "dismiss", help: id });
    const again = call(deps, { verb: "horizon", kind: "question", text, domain: "tax-law", task: "t1" });
    assert.equal(again.reason, "dismissed_in_task");
    assert.equal(call(deps, { verb: "report" }).horizonDomains?.[0]?.dismissed, 1);
    assert.equal(help(deps, text, { task: "t2" })?.state, "shown");
  });

  it("an answered source-span criterion produces a claim that enters verify", () => {
    const deps = world();
    const id = help(deps, "What is the reduced rate for e-books?", {
      criterion: "source-span",
      answer: '10.1000/vat-2022 "the reduced rate for e-books is 5%"',
    })?.help;
    const accepted = call(deps, { verb: "accept", help: id });
    assert.equal(accepted.claim?.outcome, "verified");
    assert.equal(accepted.claim.state, "machine-verified");
  });
});

const tool = (deps: JudgeDeps, name: string, input: Readonly<Record<string, string>>) =>
  horizonActed({
    event: "PostToolUse",
    cwd: deps.paths.root,
    runtime: deps.runtime as Runtime,
    t: createTranslator("en"),
    env: {},
    payload: {
      hookEventName: "PostToolUse",
      sessionId: "s1",
      cwd: deps.paths.root,
      stopHookActive: false,
      raw: { tool_name: name, tool_input: { ...input } },
    },
  });

const outcomes = (deps: JudgeDeps): readonly (readonly [string, string])[] => {
  const log = deps.runtime.readText(deps.paths.log);
  const texts = new Map(
    (call(deps, { verb: "export" }).export?.horizon ?? []).map((entry) => [entry.id, entry.text] as const),
  );
  return outcomeMarks(log.ok ? log.value : "").map((mark) => [texts.get(mark.help) ?? mark.help, mark.outcome]);
};

describe("horizon help acted on is recognizable, help left alone is out of reach", () => {
  it("running the suggested check, editing the named file and answering the question each count", async () => {
    const deps = world();
    writeState(deps.runtime as Runtime, deps.paths, { active: "t1", done: [] });
    help(deps, "Does rounding hold for refunds?", { criterion: "check", answer: "npm test -- refunds" });
    help(deps, "Look at src/billing/rounding.ts before changing the total");
    help(deps, "Which currency does the shop settle in?");
    help(deps, "Is the threshold per year?");
    await tool(deps, "Bash", { command: "npm  test -- refunds --reporter dot" });
    await tool(deps, "Edit", { file_path: "/home/ana/project/src/billing/rounding.ts" });
    help(deps, "Which currency does the shop settle in?", { answer: "BRL" });
    closeHorizon(deps.runtime, deps.paths, "t1");
    assert.deepEqual(outcomes(deps), [
      ["Does rounding hold for refunds?", "recognizable"],
      ["Look at src/billing/rounding.ts before changing the total", "recognizable"],
      ["Which currency does the shop settle in?", "recognizable"],
      ["Is the threshold per year?", "out_of_reach"],
    ]);
  });
});
