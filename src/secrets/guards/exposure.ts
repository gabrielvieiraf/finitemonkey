import { optionalString } from "../../core/parsed.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { acceptedFingerprints, EMPTY_BASELINE, loadBaseline } from "../baseline.js";
import { scanText, type SecretFinding } from "../engine.js";
import { type IncidentDraft, recordIncident } from "../incidents.js";
import { CREDENTIAL_RULES } from "../rules/catalog.js";
import { describeFindings, lineWhere } from "./describe.js";
import { stringLeaves, toolName } from "./tool-input.js";

export const HOOK_ACTOR = "finitemonkey";

const liveFindings = (input: HookInput, texts: readonly string[]): readonly SecretFinding[] => {
  const baseline = loadBaseline(input.runtime, input.cwd);
  const accepted = acceptedFingerprints(baseline.ok ? baseline.value : EMPTY_BASELINE, input.runtime.now());
  return texts
    .flatMap((text) => scanText(text, { rules: CREDENTIAL_RULES }))
    .filter((finding) => !accepted.has(finding.fingerprint));
};

const record = (
  input: HookInput,
  findings: readonly SecretFinding[],
  draft: Omit<IncidentDraft, "rule" | "fingerprint" | "where">,
  where: string,
): string => {
  const ids = findings.map((finding) => {
    const saved = recordIncident(
      input.runtime,
      input.cwd,
      { ...draft, rule: finding.ruleId, fingerprint: finding.fingerprint, where: `${where}:${String(finding.line)}` },
      HOOK_ACTOR,
    );
    return saved.ok ? saved.value.id : input.t("secrets.incident.unsaved", { detail: saved.error });
  });
  return [...new Set(ids)].join(", ");
};

export const secretsUserPromptSubmit: HookHandler = (input): HookDecision => {
  const prompt = optionalString(input.payload.raw, "prompt") ?? "";
  const findings = liveFindings(input, [prompt]);
  if (findings.length === 0) return { kind: "allow" };
  const incident = record(input, findings, { source: "prompt", state: "exposicao-local" }, "prompt");
  const items = findings.map((finding) => ({ ruleId: finding.ruleId, where: lineWhere(input.t, finding) }));
  return {
    kind: "block",
    reason: input.t("secrets.block.prompt", { found: describeFindings(input.t, items), incident }),
  };
};

export const secretsPostToolUse: HookHandler = (input): HookDecision => {
  const findings = liveFindings(input, stringLeaves(input.payload.raw["tool_response"]));
  if (findings.length === 0) return { kind: "allow" };
  const tool = toolName(input.payload) || "tool";
  const incident = record(input, findings, { source: "tool-output", state: "aberto" }, `tool-output:${tool}`);
  const items = findings.map((finding) => ({ ruleId: finding.ruleId, where: lineWhere(input.t, finding) }));
  const context = input.t("secrets.post.context", { tool, found: describeFindings(input.t, items), incident });
  return {
    kind: "allow",
    output: { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } },
  };
};
