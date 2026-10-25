import { scanText, type SecretFinding } from "../secrets/engine.js";
import { CREDENTIAL_RULES } from "../secrets/rules/catalog.js";

export const maskToken = (finding: Pick<SecretFinding, "ruleId" | "tail">): string =>
  `«secret:${finding.ruleId}:${finding.tail}»`;

export const maskText = (text: string): string => {
  const findings = scanText(text, { rules: CREDENTIAL_RULES });
  if (findings.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const finding of findings) {
    out += text.slice(cursor, finding.start) + maskToken(finding);
    cursor = finding.end;
  }
  return out + text.slice(cursor);
};

export const maskDeep = (value: unknown): unknown => {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [maskText(key), maskDeep(inner)]));
  }
  return value;
};
