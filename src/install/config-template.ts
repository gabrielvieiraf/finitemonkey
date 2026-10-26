import type { Lang } from "../i18n/languages.js";
import { GENERATED_MARKER, type Preset } from "./layout.js";
import { TEMPLATES } from "./templates/index.js";

export const configTemplate = (preset: Preset, lang: Lang): string =>
  [
    `# ${GENERATED_MARKER}`,
    `# ${TEMPLATES[lang].configHeader}`,
    "schemaVersion: 1",
    `preset: ${preset}`,
    `lang: ${lang}`,
    "",
  ].join("\n");

export const hasMarker = (text: string): boolean => text.includes(GENERATED_MARKER);
