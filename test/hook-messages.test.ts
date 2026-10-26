import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deny } from "../src/guards/context.js";
import { modelReason, REASON_LIMIT, type ReasonBase } from "../src/hooks/reason.js";
import { catalogs } from "../src/i18n/catalogs.js";
import { checkCatalogs, MODEL_FACING } from "../src/i18n/check.js";
import { LANGUAGES } from "../src/i18n/languages.js";
import { createTranslator, placeholdersOf } from "../src/i18n/translate.js";

const bases = (): readonly ReasonBase[] =>
  Object.keys(catalogs.en)
    .filter((key) => key.endsWith(".claim"))
    .map((key) => key.slice(0, -".claim".length))
    .filter((base): base is ReasonBase =>
      /^(secrets\.block|git\.block|prod\.block|prose\.block|gate\.guard)\./.test(base),
    );

describe("model-facing hook messages", () => {
  for (const lang of LANGUAGES) {
    it(`every guard reason in ${lang} is three factual lines`, () => {
      const t = createTranslator(lang);
      for (const base of bases()) {
        const claim = catalogs[lang][`${base}.claim`];
        const requires = catalogs[lang][`${base}.requires`];
        const names = [...placeholdersOf(claim), ...placeholdersOf(requires)];
        const params = Object.fromEntries(names.map((name) => [name, "x"]));
        const lines = modelReason(t, base, params).split("\n");
        assert.equal(lines.length, 3, base);
        assert.ok(
          lines.every((line) => line.trim().length > 0 && !line.includes("{")),
          `${base}: ${lines.join(" | ")}`,
        );
      }
    });
  }

  it("covers every guard family and leaves no old one-line block key behind", () => {
    const families = new Set(bases().map((base) => base.split(".").slice(0, 2).join(".")));
    for (const family of ["secrets.block", "git.block", "prod.block", "prose.block", "gate.guard"]) {
      assert.ok(families.has(family), family);
    }
    const leftovers = Object.keys(catalogs.en).filter(
      (key) =>
        /^(secrets\.block|git\.block|prod\.block|prose\.block|gate\.guard)\./.test(key) &&
        !/\.(claim|requires|not|human|shell)$/.test(key) &&
        key !== "secrets.block.prompt",
    );
    assert.deepEqual(leftovers, []);
  });

  it("caps model-facing text at 10,000 characters per hook output", () => {
    const t = createTranslator("en");
    const reason = modelReason(t, "git.block.foreign", { command: "git reset --hard", files: "a".repeat(20_000) });
    assert.equal(reason.length, REASON_LIMIT);
    const decision = deny("x".repeat(REASON_LIMIT * 2), "person line");
    assert.equal(decision.kind === "block" ? decision.reason.length : 0, REASON_LIMIT);
  });
});

describe("release hints are linted out of model-facing keys", () => {
  const base = {
    en: {
      "demo.block.claim": "a claim",
      "demo.block.requires": "fix it",
      "demo.block.human": "type finitemonkey: allow tests <why>",
    },
    "pt-BR": {
      "demo.block.claim": "uma afirmação",
      "demo.block.requires": "corrija",
      "demo.block.human": "digite finitemonkey: allow tests <motivo>",
    },
    es: {
      "demo.block.claim": "una afirmación",
      "demo.block.requires": "corrígelo",
      "demo.block.human": "escribe finitemonkey: allow tests <motivo>",
    },
  };

  it("person-facing keys may carry the release line", () => {
    assert.deepEqual(checkCatalogs(base).problems, []);
  });

  const failing = [
    { lang: "en", key: "demo.block.requires", text: "rerun with --yes" },
    { lang: "pt-BR", key: "demo.block.requires", text: "rode finitemonkey: allow tests depois" },
    { lang: "es", key: "demo.block.claim", text: "exporta FINITEMONKEY_GATE=off y repite" },
    { lang: "en", key: "demo.block.claim", text: "set SKIP=1 before the commit" },
    { lang: "pt-BR", key: "demo.block.claim", text: "rode fm off antes" },
  ] as const;
  for (const { lang, key, text } of failing) {
    it(`fails on "${text}" in ${lang}`, () => {
      const input = { ...base, [lang]: { ...base[lang], [key]: text } };
      const problems = checkCatalogs(input).problems.filter((problem) => problem.kind === "release_hint");
      assert.deepEqual(
        problems.map((problem) => [problem.lang, problem.key]),
        [[lang, key]],
      );
    });
  }

  it("knows which keys the model reads", () => {
    assert.ok(MODEL_FACING.test("git.block.clean.requires"));
    assert.ok(!MODEL_FACING.test("gate.guard.tests.human"));
  });
});
