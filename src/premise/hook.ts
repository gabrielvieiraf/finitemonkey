import { basename } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { optionalString } from "../core/parsed.js";
import { logEvent } from "../evidence/log.js";
import { human, projectPaths } from "../gate/hooks/common.js";
import { nextAssumptionId, readAssumptions, writeAssumptions } from "../guardian/assumptions.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { parseTranscript, type ToolUse } from "../history/transcript.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { agrees, type Premise, premiseIn } from "./detect.js";

export const PREMISE_FEATURE = "premise-check";
const PENDING_FILE = "premise.json";
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
const RUN_TOOLS = new Set(["Bash", "PowerShell"]);

const allow = { kind: "allow" } as const;

interface Pending {
  readonly session: string;
  readonly kind: string;
  readonly refs: readonly string[];
}

const register = (input: HookInput, paths: FmPaths, premise: Premise): void => {
  const list = readAssumptions(input.runtime, paths);
  const item = {
    id: nextAssumptionId(list),
    text: premise.text,
    source: "premise",
    impact: "low" as const,
    breaks: "",
    confidence: "low" as const,
    verify: premise.refs.join(", "),
    status: "unverified" as const,
    at: input.runtime.now(),
  };
  writeAssumptions(input.runtime, paths, [...list, item]);
};

export const premiseOnPrompt: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const premise = comesFromPerson(prompt) ? premiseIn(prompt) : undefined;
  const paths = projectPaths(input);
  if (premise === undefined || paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return allow;
  const session = input.payload.sessionId ?? "";
  writeJsonFile(input.runtime, paths.cache(PENDING_FILE), { session, kind: premise.kind, refs: [...premise.refs] });
  logEvent(input.runtime, paths, "premise.detected", { kind: premise.kind, refs: premise.refs.length });
  if (featureMode(input.runtime, paths, PREMISE_FEATURE) === "active") register(input, paths, premise);
  return allow;
};

const pendingOf = (input: HookInput, paths: FmPaths): Pending | undefined => {
  const raw = readJsonFile(input.runtime, paths.cache(PENDING_FILE));
  const session = raw === undefined ? undefined : optionalString(raw, "session");
  if (raw === undefined || session !== (input.payload.sessionId ?? "")) return undefined;
  const refs = Array.isArray(raw["refs"]) ? raw["refs"].filter((ref): ref is string => typeof ref === "string") : [];
  return { session, kind: optionalString(raw, "kind") ?? "fact", refs };
};

const touches = (tool: ToolUse, refs: readonly string[]): boolean => {
  const values = Object.values(tool.input).filter((value): value is string => typeof value === "string");
  return refs.some((ref) => values.some((value) => value.includes(ref) || value.includes(basename(ref))));
};

export const checked = (tools: readonly ToolUse[], refs: readonly string[]): boolean =>
  tools.some(
    (tool) => RUN_TOOLS.has(tool.name) || (READ_TOOLS.has(tool.name) && (refs.length === 0 || touches(tool, refs))),
  );

const turnTools = (input: HookInput): readonly ToolUse[] => {
  const file = textField(input.payload.raw, "transcript_path");
  if (file === undefined || file === "") return [];
  const text = input.runtime.readText(toAbsolutePath(file));
  return text.ok ? (parseTranscript(text.value).at(-1)?.tools ?? []) : [];
};

export const premiseOnStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  const pending = paths === undefined ? undefined : pendingOf(input, paths);
  if (paths === undefined || pending === undefined || input.payload.stopHookActive) return allow;
  input.runtime.remove(paths.cache(PENDING_FILE));
  const agreed = agrees(textField(input.payload.raw, "last_assistant_message") ?? "");
  const evidence = checked(turnTools(input), pending.refs);
  logEvent(input.runtime, paths, "premise.checked", { kind: pending.kind, agreed, evidence });
  if (!agreed || evidence) return allow;
  if (featureMode(input.runtime, paths, PREMISE_FEATURE) !== "active") {
    recordFeatureShadow(input.runtime, paths, PREMISE_FEATURE, { kind: pending.kind, refs: pending.refs.length });
    return allow;
  }
  const refs = pending.refs.length === 0 ? "-" : pending.refs.join(", ");
  return { kind: "allow", output: { systemMessage: human(input.t("premise.notice", { refs })) } };
};

export const PREMISE_HANDLERS: HookHandlers = { UserPromptSubmit: [premiseOnPrompt], Stop: [premiseOnStop] };
