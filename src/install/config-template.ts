import type { Lang } from "../i18n/languages.js";
import type { Translate } from "../i18n/translate.js";
import { GENERATED_MARKER, type Preset } from "./layout.js";

export const configTemplate = (t: Translate, preset: Preset, lang: Lang): string =>
  [
    `# ${GENERATED_MARKER}`,
    `# ${t("install.config.header")}`,
    "schemaVersion: 1",
    `preset: ${preset}`,
    `lang: ${lang}`,
    "",
  ].join("\n");

export const hasMarker = (text: string): boolean => text.includes(GENERATED_MARKER);
