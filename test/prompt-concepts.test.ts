import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { EMPTY_BOOK, raise, readBook, writeBook } from "../src/conceitos/book.js";
import type { ConceptId } from "../src/conceitos/concepts.js";
import { type ConceptEvent, type ConceptEventKind, readConceptEvents, WEIGHTS } from "../src/conceitos/evidence.js";
import { studiedConcept } from "../src/conceitos/prompt-topics.js";
import { trajectories } from "../src/conceitos/trajectory.js";
import { perfilPrompt } from "../src/perfil/hooks.js";
import { DOMAINS } from "../src/perfil/types.js";
import { fmPaths } from "../src/task/paths.js";
import { hook, runtime, type TempRepo, tempRepo, write } from "./git-support.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const repo = (): TempRepo => {
  const made = tempRepo({ "src/a.js": "export const a = 1;\n" });
  repos.push(made);
  write(made.root, ".finitemonkey/policy.yml", "guards: {}\n");
  return made;
};

const logged = (root: TempRepo["root"]): readonly (readonly [string, string, string])[] =>
  readConceptEvents(runtime, fmPaths(root)).map((item) => [item.concept, item.kind, item.origin] as const);

describe("concepts from what the person studies", () => {
  it("names the field and topic of a study prompt in English, Portuguese and Spanish", () => {
    assert.equal(studiedConcept("I'm trying to understand law properly"), "law/law");
    assert.equal(studiedConcept("Estou tentando entender direito tributário."), "law/direito-tributario");
    assert.equal(studiedConcept("quiero aprender estadística bayesiana"), "statistics/estadistica-bayesiana");
    assert.equal(studiedConcept("I want to learn about harmony for guitar"), "music/harmony");
    assert.equal(studiedConcept("help me study the history of Rome, please"), "history/history-of-rome");
    assert.equal(studiedConcept("teach me webhooks"), "backend/integration/webhook");
    assert.equal(studiedConcept("I'm learning pottery"), "general/pottery");
  });

  it("leaves ordinary work prompts alone", () => {
    assert.equal(studiedConcept("I need to understand why this test fails"), undefined);
    assert.equal(studiedConcept("Add an idempotency key to the webhook"), undefined);
    assert.equal(studiedConcept("I want to understand src/gate/hooks.ts"), undefined);
    assert.equal(studiedConcept("quero entender o erro do build"), undefined);
  });

  it("an empty book and a prompt about a field outside programming create the concept and an exposure", async () => {
    const made = repo();
    await hook(perfilPrompt, "UserPromptSubmit", made.root, {
      prompt: "Estou tentando entender direito tributário de verdade",
    });
    assert.equal(readBook(runtime, fmPaths(made.root)).concepts["law/direito-tributario"]?.level, "seen");
    assert.deepEqual(logged(made.root), [["law/direito-tributario", "exposure", "person"]]);
  });

  it("a prompt that names an alias records against the concept it points to and creates no duplicate", async () => {
    const made = repo();
    const paths = fmPaths(made.root);
    const book = raise(EMPTY_BOOK, "law/tax-law", "seen", "2026-10-01T00:00:00Z");
    writeBook(runtime, paths, { ...book, aliases: { "law/direito-tributario": "law/tax-law" } });
    await hook(perfilPrompt, "UserPromptSubmit", made.root, { prompt: "Revisa o caso de direito tributário" });
    await hook(perfilPrompt, "UserPromptSubmit", made.root, { prompt: "quero entender direito tributário melhor" });
    assert.deepEqual(Object.keys(readBook(runtime, paths).concepts), ["law/tax-law"]);
    assert.deepEqual(logged(made.root), [
      ["law/tax-law", "exposure", "person"],
      ["law/tax-law", "exposure", "person"],
    ]);
  });

  it("a prompt about a concept already in the book records against it", async () => {
    const made = repo();
    const paths = fmPaths(made.root);
    writeBook(runtime, paths, raise(EMPTY_BOOK, "law/law", "seen", "2026-10-01T00:00:00Z"));
    await hook(perfilPrompt, "UserPromptSubmit", made.root, { prompt: "I'm trying to understand law properly" });
    assert.deepEqual(Object.keys(readBook(runtime, paths).concepts), ["law/law"]);
    assert.deepEqual(logged(made.root), [["law/law", "exposure", "person"]]);
  });
});

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-29T12:00:00Z");

const event = (days: number, concept: ConceptId, kind: ConceptEventKind): ConceptEvent => ({
  at: new Date(NOW - days * DAY).toISOString(),
  concept,
  kind,
  origin: "person",
  weight: WEIGHTS[kind],
});

describe("trajectory of fields outside programming", () => {
  it("keeps the programming domains first and adds a field once its concepts have events", () => {
    const names = trajectories([event(3, "law/law", "exposure")], [], NOW).map((item) => item.domain);
    assert.deepEqual(names, [...DOMAINS, "law"]);
    assert.equal(trajectories([], [], NOW).length, DOMAINS.length);
  });

  it("reports data for a field once enough weighted events exist across weeks", () => {
    const thin = [event(3, "law/law", "exposure"), event(10, "law/law", "exposure")];
    assert.equal(trajectories(thin, [], NOW).find((item) => item.domain === "law")?.status, "no_data");
    const weighted = [
      ...thin,
      event(20, "law/contracts", "explanation_right"),
      event(20, "law/law", "prediction_right"),
      event(13, "research/law/tax", "check_right"),
      event(13, "law/contracts", "prediction_right"),
      event(6, "law/law", "explanation_right"),
      event(6, "law/contracts", "prediction_wrong"),
    ];
    const law = trajectories(weighted, [], NOW).find((item) => item.domain === "law");
    assert.ok(law !== undefined);
    assert.equal(law.status, "ok");
    assert.equal(law.evidence, 6);
    assert.equal(law.weeks.length, 12);
  });
});
