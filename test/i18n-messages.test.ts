import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { catalogs, reviewStatus } from "../src/i18n/catalogs.js";
import { checkCatalogs } from "../src/i18n/check.js";
import { argumentsOf, formatMessage, requiredPluralBranches } from "../src/i18n/message.js";
import { createTranslator } from "../src/i18n/translate.js";
import { CONFIG_FILE } from "../src/install/layout.js";
import { cli, fakeRuntime } from "./support.js";

describe("ICU messages", () => {
  const files = "{count, plural, =0 {no files} one {# file} other {# files}} in {dir}";

  it("picks the plural branch for each count and language", () => {
    assert.equal(formatMessage(files, { count: 0, dir: "src" }, "en"), "no files in src");
    assert.equal(formatMessage(files, { count: 1, dir: "src" }, "en"), "1 file in src");
    assert.equal(formatMessage(files, { count: 7, dir: "src" }, "en"), "7 files in src");
    const pt = "{count, plural, one {# arquivo} other {# arquivos}}";
    assert.equal(formatMessage(pt, { count: 0 }, "pt-BR"), "0 arquivo");
    assert.equal(formatMessage(pt, { count: 2 }, "pt-BR"), "2 arquivos");
    assert.equal(formatMessage("{count, plural, one {# archivo} other {# archivos}}", { count: 1 }, "es"), "1 archivo");
  });

  it("handles select, placeholders inside branches and a literal # outside plural", () => {
    const text = "PR #{number}: {state, select, open {open by {who}} other {closed}}";
    assert.equal(formatMessage(text, { number: 7, state: "open", who: "ana" }, "en"), "PR #7: open by ana");
    assert.equal(formatMessage(text, { number: 7, state: "merged" }, "en"), "PR #7: closed");
    assert.deepEqual(argumentsOf(text), ["number", "state", "who"]);
  });

  it("leaves unknown arguments and malformed braces as written", () => {
    assert.equal(formatMessage("{missing} and {not closed", {}, "en"), "{missing} and {not closed");
  });

  it("knows which plural branches each language needs", () => {
    assert.deepEqual(requiredPluralBranches("en"), ["one", "other"]);
    assert.deepEqual(requiredPluralBranches("es"), ["one", "other"]);
    assert.ok(requiredPluralBranches("pt-BR").includes("one"));
  });

  it("the shipped catalogs pass the check, review statuses included", () => {
    assert.deepEqual(checkCatalogs(catalogs, reviewStatus).problems, []);
  });
});

describe("i18n check on plural branches and review status", () => {
  const en = { "a.count": "{count, plural, one {# check} other {# checks}}", "a.name": "hi {name}" };

  it("fails on a missing plural branch and on a placeholder mismatch", () => {
    const report = checkCatalogs({
      en,
      "pt-BR": { "a.count": "{count, plural, other {# checagens}}", "a.name": "oi {nome}" },
      es: { "a.count": "{count} verificaciones", "a.name": "hola {name}" },
    });
    const kinds = report.problems.map((problem) => `${problem.lang} ${problem.key} ${problem.kind}`);
    assert.deepEqual(kinds, ["pt-BR a.count plural", "pt-BR a.name placeholder", "es a.count plural"]);
  });

  it("fails when English itself lacks a branch", () => {
    const report = checkCatalogs({ en: { "a.count": "{count, plural, other {# checks}}" }, "pt-BR": {}, es: {} });
    assert.ok(report.problems.some((problem) => problem.lang === "en" && problem.kind === "plural"));
  });

  it("fails on a key without a review status and on a status for a key that does not exist", () => {
    const report = checkCatalogs(
      { en: { "a.name": "hi {name}" }, "pt-BR": { "a.name": "oi {name}" }, es: { "a.name": "hola {name}" } },
      { "pt-BR": { "a.name": "machine" }, es: { "a.name": "maybe", "a.gone": "reviewed" } },
    );
    const kinds = report.problems.map((problem) => `${problem.lang} ${problem.key} ${problem.kind}`);
    assert.deepEqual(kinds, ["es a.name status", "es a.gone extra"]);
  });
});

describe("reviewed-only fallback", () => {
  const source = {
    en: { "help.usage": "Usage", "help.flags": "Flags" },
    "pt-BR": { "help.usage": "Uso", "help.flags": "Opções" },
    es: {},
  };

  it("keys with status machine fall back to English when only reviewed text is allowed", () => {
    const t = createTranslator("pt-BR", source, { reviewed: new Set(["help.usage"]) });
    assert.equal(t("help.usage"), "Uso");
    assert.equal(t("help.flags"), "Flags");
    assert.equal(createTranslator("pt-BR", source)("help.flags"), "Opções");
  });

  it("i18n.fallback: reviewed-only in config.yml switches machine text to English", async () => {
    const root = toAbsolutePath("/home/ana/project");
    const runtime = fakeRuntime({
      files: { [join(root, CONFIG_FILE)]: "lang: pt-BR\ni18n:\n  fallback: reviewed-only\n" },
    });
    const plain = await cli(["frobnicate"], { env: { LANG: "pt_BR.UTF-8" } });
    assert.match(plain.stderr, /Comando desconhecido/);
    const strict = await cli(["frobnicate"], { env: { LANG: "pt_BR.UTF-8" }, runtime });
    assert.match(strict.stderr, /Unknown command/);
  });
});
