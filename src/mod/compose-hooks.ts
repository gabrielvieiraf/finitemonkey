import type { ModApi } from "./api.js";
import { runCli } from "./cli.js";
import type {
  Next,
  PromptComposeInput,
  PromptComposeResult,
  SessionCompactInput,
  SessionCompactResult,
} from "./events.js";
import { memory } from "./memory.js";

export const RULES_SECTION = "finitemonkey:rules";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const withRulesSection = (result: PromptComposeResult, text: string): PromptComposeResult =>
  text === ""
    ? result
    : {
        sections: [
          ...result.sections.filter((section) => section.id !== RULES_SECTION),
          { id: RULES_SECTION, text, scope: "session" },
        ],
      };

export const parseHandoff = (text: string): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord(data) && data["schema"] === "finitemonkey/handoff@1" && typeof data["text"] === "string"
    ? data["text"]
    : undefined;
};

export async function readHandoff($: ModApi): Promise<string | undefined> {
  const text = await runCli($, ["handoff", "--json"]);
  return text === undefined ? undefined : parseHandoff(text);
}

export async function composeRules(
  _$: ModApi,
  e: PromptComposeInput,
  next: Next<"prompt.compose">,
): Promise<PromptComposeResult> {
  return withRulesSection(await next(e), memory.state?.instructions ?? "");
}

export async function compactNotes(
  $: ModApi,
  e: SessionCompactInput,
  next: Next<"session.compact">,
): Promise<SessionCompactResult> {
  if (e.agentId !== undefined) return next(e);
  const brief = await readHandoff($);
  if (brief === undefined || brief === "") return next(e);
  const instructions = [e.instructions ?? "", brief].filter((part) => part !== "").join("\n\n");
  return next({ ...e, instructions });
}
