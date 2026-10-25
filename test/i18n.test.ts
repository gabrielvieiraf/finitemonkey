import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { catalogs } from "../src/i18n/catalogs.js";
import { checkCatalogs } from "../src/i18n/check.js";
import { detectLang, LANGUAGES, normalizeLang } from "../src/i18n/languages.js";
import { createTranslator, interpolate, placeholdersOf } from "../src/i18n/translate.js";
import { cli, cliJson, field } from "./support.js";

describe("i18n catalogs", () => {
  it("pt-BR, en and es have the same keys and placeholders", () => {
    const report = checkCatalogs(catalogs);
    assert.deepEqual(report.problems, []);
    assert.deepEqual(report.languages, ["en", "pt-BR", "es"]);
    assert.ok(report.keys > 50);
  });

  it("flags missing, extra, empty, non-text and placeholder mismatches", () => {
    const report = checkCatalogs({
      en: { a: "A {x}", b: "B", e: "E" },
      "pt-BR": { a: "A {y}", e: " " },
      es: { a: "A {x}", b: 3, c: "C", e: "E" },
    });
    const found = report.problems.map(({ lang, key, kind }) => `${lang}:${key}:${kind}`).sort();
    assert.deepEqual(found, [
      "es:b:not_string",
      "es:c:extra",
      "pt-BR:a:placeholder",
      "pt-BR:b:missing",
      "pt-BR:e:empty",
    ]);
  });
});

describe("translation", () => {
  it("interpolates named placeholders and leaves unknown ones visible", () => {
    assert.equal(interpolate("hi {name}, {missing}", { name: "Ana" }), "hi Ana, {missing}");
    assert.deepEqual(placeholdersOf("{b} {a} {b}"), ["a", "b"]);
  });

  it("falls back to en when a language lacks the key, then to the key itself", () => {
    const t = createTranslator("es", { en: { "help.usage": "Usage {n}" }, "pt-BR": {}, es: {} });
    assert.equal(t("help.usage", { n: 1 }), "Usage 1");
    assert.equal(t("help.flags"), "help.flags");
  });
});

describe("language detection", () => {
  const normalized = [
    ["pt_BR.UTF-8", "pt-BR"],
    ["pt_PT", "pt-BR"],
    ["PT-br", "pt-BR"],
    ["es_MX.utf8", "es"],
    ["en_US", "en"],
    ["C.UTF-8", undefined],
    ["POSIX", undefined],
    ["fr_FR", undefined],
    ["", undefined],
  ] as const;
  for (const [raw, lang] of normalized) {
    it(`normalizes "${raw}" to ${String(lang)}`, () => {
      assert.equal(normalizeLang(raw), lang);
    });
  }

  const ordered = [
    { flag: "pt-BR", env: { FINITEMONKEY_LANG: "en", LC_ALL: "es_ES" }, lang: "pt-BR", source: "flag" },
    {
      flag: undefined,
      env: { FINITEMONKEY_LANG: "es", LC_ALL: "pt_BR.UTF-8" },
      lang: "es",
      source: "FINITEMONKEY_LANG",
    },
    { flag: undefined, env: { LC_ALL: "pt_BR.UTF-8", LANG: "es_ES" }, lang: "pt-BR", source: "LC_ALL" },
    { flag: undefined, env: { LC_MESSAGES: "es_AR", LANG: "pt_BR" }, lang: "es", source: "LC_MESSAGES" },
    { flag: undefined, env: { LANG: "es_ES.UTF-8" }, lang: "es", source: "LANG" },
    { flag: undefined, env: { LC_ALL: "C", LANG: "fr_FR" }, lang: "en", source: "default" },
    { flag: undefined, env: {}, lang: "en", source: "default" },
  ] as const;
  for (const { flag, env, lang, source } of ordered) {
    it(`picks ${lang} from ${source}`, () => {
      assert.deepEqual(detectLang(flag, env), { lang, source });
    });
  }
});

describe("--lang override", () => {
  const env = { LANG: "es_ES.UTF-8" };
  const cases = [
    { argv: ["frobnicate"], text: /Comando desconocido/ },
    { argv: ["frobnicate", "--lang", "pt-BR"], text: /Comando desconhecido/ },
    { argv: ["frobnicate", "--lang=en"], text: /Unknown command/ },
  ] as const;
  for (const { argv, text } of cases) {
    it(`${argv.join(" ")} speaks ${String(text)}`, async () => {
      assert.match((await cli(argv, { env })).stderr, text);
    });
  }

  it("translates the message but never the error code", async () => {
    const { body } = await cliJson(["frobnicate", "--lang", "pt-BR"], { env });
    assert.equal(field(body, "error", "code"), "unknown_command");
    assert.match(String(field(body, "error", "message")), /Comando desconhecido/);
  });

  for (const lang of LANGUAGES) {
    it(`localizes help in ${lang}`, async () => {
      const t = createTranslator(lang);
      const { stdout } = await cli(["help", "--lang", lang]);
      assert.ok(stdout.includes(`${t("help.commands")}:`));
      assert.ok(stdout.includes(t("command.doctor.summary")));
    });
  }
});
