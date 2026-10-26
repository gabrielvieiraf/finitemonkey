import type { Lang } from "../i18n/languages.js";
import { DEFAULT_PROMOTE_AFTER, OPTIONAL_GUARDS } from "../policy/policy.js";
import { GENERATED_MARKER } from "./layout.js";
import { TEMPLATES } from "./templates/index.js";

export const policyTemplate = (lang: Lang): string =>
  [
    `# ${GENERATED_MARKER}`,
    ...TEMPLATES[lang].policyHeader.map((line) => `# ${line}`),
    "level: standard",
    "severity: medium",
    `promoteAfter: ${String(DEFAULT_PROMOTE_AFTER)}`,
    "guards:",
    ...OPTIONAL_GUARDS.map((id) => `  ${id}: active`),
    "",
  ].join("\n");
