import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { billingOf } from "../src/bridge/billing.js";
import { modLabelsOf } from "../src/commands/mod-labels.js";
import { toAbsolutePath } from "../src/core/brand.js";
import {
  conversationLangPath,
  guessLang,
  readConversationLang,
  recordConversationLang,
} from "../src/i18n/conversation.js";
import { CONFIG_FILE } from "../src/install/layout.js";
import { costLines } from "../src/mod/cost-hooks.js";
import { label, parseLabels, useLabels } from "../src/mod/labels.js";
import { MOD_LABELS_EN, MOD_LABELS_SCHEMA } from "../src/mod/labels-en.js";
import { costBand } from "../src/mod/status.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");

const runtimeWith = (files: Readonly<Record<string, string>> = {}) =>
  fakeRuntime({ fs: memoryFs(files, [join(ROOT, ".git")]) });

describe("conversation language guess", () => {
  it("recognizes the language the person writes in", () => {
    assert.equal(guessLang("tem que reparar qual lingua que eu to falando com o agente"), "pt-BR");
    assert.equal(guessLang("o preço por contrato so faz sentido se a gente usa a API"), "pt-BR");
    assert.equal(guessLang("please fix the failing test in the parser and add a case"), "en");
    assert.equal(guessLang("necesito que el panel muestre los tokens cuando no hay API"), "es");
  });

  it("keeps quiet on prompts that are too short or carry no language", () => {
    assert.equal(guessLang("ok"), undefined);
    assert.equal(guessLang("sim pode"), undefined);
    assert.equal(guessLang("git push origin main"), undefined);
  });

  it("does not count pasted code or paths as the person's language", () => {
    assert.equal(guessLang("corrige isso aqui pra mim agora ```the error is that the value is not set```"), "pt-BR");
  });

  it("records the last confident guess and keeps it when a prompt is ambiguous", () => {
    const runtime = runtimeWith();
    assert.equal(recordConversationLang(runtime, ROOT, "o bagulho ali no painel fica em inglês"), "pt-BR");
    assert.equal(recordConversationLang(runtime, ROOT, "ok"), undefined);
    assert.equal(readConversationLang(runtime, ROOT), "pt-BR");
    const saved = runtime.readText(conversationLangPath(ROOT));
    assert.ok(saved.ok && saved.value.includes('"lang":"pt-BR"'));
  });
});

describe("billing mode", () => {
  it("is api when Claude Code bills per token and subscription otherwise", () => {
    const runtime = runtimeWith();
    assert.equal(billingOf(runtime, ROOT, {}), "subscription");
    assert.equal(billingOf(runtime, ROOT, { ANTHROPIC_API_KEY: "x" }), "api");
    assert.equal(billingOf(runtime, ROOT, { CLAUDE_CODE_USE_BEDROCK: "1" }), "api");
    assert.equal(billingOf(runtime, ROOT, { ANTHROPIC_API_KEY: " " }), "subscription");
  });

  it("treats an apiKeyHelper in Claude Code settings as api billing", () => {
    const runtime = runtimeWith({ [join(ROOT, ".claude", "settings.json")]: '{"apiKeyHelper":"~/bin/key.sh"}' });
    assert.equal(billingOf(runtime, ROOT, {}), "api");
  });

  it("lets config.yml choose", () => {
    const runtime = runtimeWith({ [join(ROOT, CONFIG_FILE)]: "billing: subscription\n" });
    assert.equal(billingOf(runtime, ROOT, { ANTHROPIC_API_KEY: "x" }), "subscription");
  });
});

describe("mod labels", () => {
  afterEach(() => {
    useLabels(undefined);
  });

  it("the CLI serves every mod label in each language", () => {
    for (const lang of ["en", "pt-BR", "es"] as const)
      assert.deepEqual(Object.keys(modLabelsOf({ lang })), Object.keys(MOD_LABELS_EN));
    assert.deepEqual(modLabelsOf({ lang: "en" }), MOD_LABELS_EN);
  });

  it("the pane speaks the language the CLI answered with and falls back to English", () => {
    const set = parseLabels(
      JSON.stringify({ data: { schema: MOD_LABELS_SCHEMA, lang: "pt-BR", labels: modLabelsOf({ lang: "pt-BR" }) } }),
    );
    useLabels(set);
    assert.equal(label("mod.view.not_verified_title"), "não verificado:");
    assert.equal(
      label("mod.view.knowledge", { stale: 1, contradictions: 2, quarantined: 0 }),
      "conhecimento: 1 desatualizado · 2 regras contradizem o código · 0 em quarentena",
    );
    useLabels({ lang: "pt-BR", labels: {} });
    assert.equal(label("mod.view.run_gate"), "Run gate");
  });

  it("shows tokens instead of dollars on a subscription", () => {
    useLabels({ lang: "pt-BR", labels: modLabelsOf({ lang: "pt-BR" }) });
    assert.equal(
      costBand({ usd: 1.5, requests: 3, tokens: 1234567, billing: "subscription" }),
      "1.234.567 tokens neste contrato",
    );
    useLabels(undefined);
    assert.equal(costBand({ usd: 1.5, requests: 3, tokens: 1234567, billing: "api" }), "$1.50 this contract");
    const tokens = { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0, total: 6200 };
    const json = JSON.stringify({
      schema: "finitemonkey/mod-cost@1",
      task: "t1",
      usd: 2,
      requests: 2,
      billing: "subscription",
      tokens,
    });
    assert.deepEqual(costLines(json), [
      "contract t1: 6,200 tokens in 2 requests",
      "input 1,000 · output 200 · cache read 5,000 · cache write 0",
    ]);
  });
});
