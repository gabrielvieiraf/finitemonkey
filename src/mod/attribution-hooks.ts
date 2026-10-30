import type { AttributionTextInput, AttributionTextResult, Next } from "./events.js";
import { memory } from "./memory.js";

const KINDS: ReadonlySet<string> = new Set(["commit", "pr"]);

export const attributionFor = (
  e: AttributionTextInput,
  decided: AttributionTextResult,
  attribution: { readonly forbid: boolean; readonly trailer: string | null } | undefined,
): AttributionTextResult => {
  if (attribution === undefined || !KINDS.has(e.kind)) return decided;
  const base = attribution.forbid ? "" : decided.text;
  const trailer = e.kind === "commit" ? attribution.trailer : null;
  return { text: [base, trailer ?? ""].filter((part) => part !== "").join("\n") };
};

export async function attributionText(
  _$: unknown,
  e: AttributionTextInput,
  next: Next<"attribution.text">,
): Promise<AttributionTextResult> {
  return attributionFor(e, await next(e), memory.state?.attribution);
}
