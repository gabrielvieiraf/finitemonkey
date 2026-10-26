import { EXPOSURE_RULES } from "./exposure.js";
import { PROVIDER_RULES } from "./providers.js";
import { STRUCTURAL_RULES } from "./structural.js";
import type { SecretRule } from "./types.js";

export const RULES: readonly SecretRule[] = [...PROVIDER_RULES, ...STRUCTURAL_RULES, ...EXPOSURE_RULES];

export const CREDENTIAL_RULES: readonly SecretRule[] = RULES.filter((rule) => rule.kind === "credential");

export const ruleById = (id: string): SecretRule | undefined => RULES.find((rule) => rule.id === id);
