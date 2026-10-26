import type { Lang } from "../i18n/languages.js";
import { hasMarker } from "./config-template.js";
import { isScript, type Runner } from "./hook-entries.js";
import { GENERATED_MARKER, LOCAL_BIN, VENDOR_BIN } from "./layout.js";
import { TEMPLATES } from "./templates/index.js";

export const cliCommand = (runner: Runner, args: string): string => {
  if (runner.kind === "local") return `node ${LOCAL_BIN} ${args}`;
  if (runner.kind === "vendored") return `node ${VENDOR_BIN} ${args}`;
  return isScript(runner.path) ? `node "${runner.path}" ${args}` : `"${runner.path}" ${args}`;
};

export const verifySkillTemplate = (runner: Runner, lang: Lang): string => {
  const skill = TEMPLATES[lang].verifySkill;
  return [
    "---",
    "name: verify",
    "description: >-",
    `  ${skill.description}`,
    "when_to_use: >-",
    `  ${skill.whenToUse}`,
    "---",
    "",
    `# ${skill.title}`,
    "",
    ...skill.steps(cliCommand(runner, "gate --fast --json")).map((step, index) => `${String(index + 1)}. ${step}`),
    "",
    `<!-- ${GENERATED_MARKER} -->`,
    "",
  ].join("\n");
};

export const isOwnSkill = hasMarker;
