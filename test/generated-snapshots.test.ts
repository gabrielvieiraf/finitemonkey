import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { LANGUAGES } from "../src/i18n/languages.js";
import { withAgentsBlock } from "../src/install/agents-block.js";
import { configTemplate } from "../src/install/config-template.js";
import { verifySkillTemplate } from "../src/install/skill-template.js";

const SNAPSHOTS = join(dirname(fileURLToPath(import.meta.url)), "snapshots", "generated");
const UPDATE = process.env["UPDATE_SNAPSHOTS"] === "1";

const GENERATED = [
  { name: "config.yml", render: (lang: (typeof LANGUAGES)[number]) => configTemplate("neutral", lang) },
  {
    name: "AGENTS.md",
    render: (lang: (typeof LANGUAGES)[number]) => withAgentsBlock(undefined, { kind: "vendored" }, lang),
  },
  {
    name: "verify-SKILL.md",
    render: (lang: (typeof LANGUAGES)[number]) => verifySkillTemplate({ kind: "vendored" }, lang),
  },
] as const;

describe("generated files per language match their snapshots", () => {
  for (const lang of LANGUAGES) {
    for (const file of GENERATED) {
      it(`${lang}/${file.name}`, () => {
        const path = join(SNAPSHOTS, lang, file.name);
        const text = file.render(lang);
        if (UPDATE) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, text);
        }
        assert.equal(text, readFileSync(path, "utf8"), `run UPDATE_SNAPSHOTS=1 npm test after reviewing ${path}`);
      });
    }
  }
});
