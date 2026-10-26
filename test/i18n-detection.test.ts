import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { ExitCode } from "../src/exit-codes.js";
import { langSettings } from "../src/i18n/lang-settings.js";
import { claudeLanguageToLang, detectLang } from "../src/i18n/languages.js";
import { CONFIG_FILE, SETTINGS_FILE } from "../src/install/layout.js";
import { memoryFs } from "./memory-fs.js";
import { BUNDLE, cliJson, fakeRuntime, field, found, parseBody } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => join(ROOT, relative);
const abs = (path: string): string => toAbsolutePath(path);

describe("language detection order", () => {
  const full = { config: "es", claude: "portuguese", system: "es-MX" };
  const env = { FINITEMONKEY_LANG: "pt-BR", LC_ALL: "es_ES", LC_MESSAGES: "pt_BR", LANG: "es_AR" };
  const cases = [
    { flag: "en", env, settings: full, lang: "en", source: "flag" },
    { flag: undefined, env, settings: full, lang: "pt-BR", source: "FINITEMONKEY_LANG" },
    { flag: undefined, env: { LC_ALL: "pt_BR" }, settings: full, lang: "es", source: "config" },
    {
      flag: undefined,
      env: { LC_ALL: "es_ES" },
      settings: { claude: "portuguese" },
      lang: "pt-BR",
      source: "claude-settings",
    },
    { flag: undefined, env: { LC_ALL: "es_ES", LANG: "pt_BR" }, settings: {}, lang: "es", source: "LC_ALL" },
    { flag: undefined, env: { LC_MESSAGES: "pt_PT", LANG: "es" }, settings: {}, lang: "pt-BR", source: "LC_MESSAGES" },
    { flag: undefined, env: { LANG: "es_CL.UTF-8" }, settings: { system: "pt-BR" }, lang: "es", source: "LANG" },
    { flag: undefined, env: {}, settings: { system: "pt-BR" }, lang: "pt-BR", source: "system" },
    {
      flag: undefined,
      env: {},
      settings: { config: "fr", claude: "japanese", system: "de-DE" },
      lang: "en",
      source: "default",
    },
  ] as const;
  for (const { flag, env: vars, settings, lang, source } of cases) {
    it(`${source} gives ${lang}`, () => {
      assert.deepEqual(detectLang(flag, vars, settings), { lang, source });
    });
  }

  it("reads Claude Code language names in the three supported languages", () => {
    assert.equal(claudeLanguageToLang("Brazilian Portuguese"), "pt-BR");
    assert.equal(claudeLanguageToLang("português"), "pt-BR");
    assert.equal(claudeLanguageToLang("spanish"), "es");
    assert.equal(claudeLanguageToLang("Español"), "es");
    assert.equal(claudeLanguageToLang("english"), "en");
    assert.equal(claudeLanguageToLang("es-MX"), "es");
    assert.equal(claudeLanguageToLang("japanese"), undefined);
  });
});

describe("where the language settings come from", () => {
  const settingsWith = (files: Readonly<Record<string, string>>, platform: NodeJS.Platform, systemLocale?: string) =>
    langSettings(
      fakeRuntime({ fs: memoryFs(files, [at(".git")]), ...(systemLocale === undefined ? {} : { systemLocale }) }),
      toAbsolutePath(at("src")),
      {},
      platform,
    );

  it("finds config.yml and Claude Code settings from a subfolder, local before project before user", () => {
    const settings = settingsWith(
      {
        [at(CONFIG_FILE)]: "# finitemonkey:generated v=1\nlang: es # chosen\n",
        [at(".claude/settings.local.json")]: '{"language":"portuguese"}',
        [at(SETTINGS_FILE)]: '{"language":"spanish"}',
        [abs("/home/test/.claude/settings.json")]: '{"language":"english"}',
      },
      "linux",
      "pt-BR",
    );
    assert.deepEqual(settings, { config: "es", reviewedOnly: false, claude: "portuguese", system: undefined });
  });

  it("falls back to the user settings, honoring CLAUDE_CONFIG_DIR", () => {
    const runtime = fakeRuntime({
      fs: memoryFs(
        {
          [abs("/home/test/.claude/settings.json")]: '{"language":"spanish"}',
          [abs("/cfg/settings.json")]: '{"language":"english"}',
        },
        [at(".git")],
      ),
    });
    assert.equal(langSettings(runtime, ROOT, {}, "linux").claude, "spanish");
    assert.equal(langSettings(runtime, ROOT, { CLAUDE_CONFIG_DIR: "/cfg" }, "linux").claude, "english");
  });

  it("asks the system culture only on Windows", () => {
    assert.equal(settingsWith({}, "win32", "pt-BR").system, "pt-BR");
    assert.equal(settingsWith({}, "darwin", "pt-BR").system, undefined);
  });
});

describe("init and the Claude Code language setting", () => {
  const repo = (files: Readonly<Record<string, string>> = {}) =>
    memoryFs(
      {
        [BUNDLE]: "#!/usr/bin/env node\nconsole.log('finitemonkey');\n",
        ...Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
      },
      [at(".git")],
    );
  const run = (fs: ReturnType<typeof memoryFs>, argv: readonly string[], env: Readonly<Record<string, string>>) =>
    cliJson(argv, { cwd: ROOT, runtime: fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } }), env });
  const languageOf = (fs: ReturnType<typeof memoryFs>): unknown =>
    field(parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}"), "language");

  it("adds the chosen language when absent, keeps it on a second run and removes only what it added", async () => {
    const fs = repo();
    assert.equal((await run(fs, ["init", "--yes"], { LANG: "pt_BR.UTF-8" })).code, ExitCode.Ok);
    assert.equal(languageOf(fs), "brazilian portuguese");
    const again = await run(fs, ["init", "--yes"], {});
    assert.equal(again.code, ExitCode.Ok);
    assert.equal(languageOf(fs), "brazilian portuguese");
    assert.equal((await run(fs, ["uninstall", "--yes", "--purge"], {})).code, ExitCode.Ok);
    assert.equal(fs.read(at(SETTINGS_FILE)), undefined);
  });

  it("never overwrites a language the settings already have, and leaves it on uninstall", async () => {
    const original = '{\n  "language": "japanese"\n}\n';
    const fs = repo({ [SETTINGS_FILE]: original });
    await run(fs, ["init", "--yes"], { LANG: "es_ES" });
    assert.equal(languageOf(fs), "japanese");
    await run(fs, ["uninstall", "--yes", "--purge"], {});
    assert.equal(fs.read(at(SETTINGS_FILE)), original);
  });

  it("does not write a language that was only the English default", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes"], {});
    assert.equal(languageOf(fs), undefined);
  });
});
