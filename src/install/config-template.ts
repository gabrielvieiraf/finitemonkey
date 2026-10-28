import { defaultsYaml, type ProjectDefaults } from "../defaults/items.js";
import type { Lang } from "../i18n/languages.js";
import { GENERATED_MARKER } from "./layout.js";
import { TEMPLATES } from "./templates/index.js";

export const configTemplate = (defaults: ProjectDefaults, lang: Lang): string =>
  [
    `# ${GENERATED_MARKER}`,
    `# ${TEMPLATES[lang].configHeader}`,
    "schemaVersion: 1",
    `lang: ${lang}`,
    ...defaultsYaml(defaults),
    "",
  ].join("\n");

export const hasMarker = (text: string): boolean => text.includes(GENERATED_MARKER);
