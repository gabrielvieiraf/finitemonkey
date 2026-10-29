import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type Front, readFronts } from "../fronts/state.js";

export const ATTENTION_SCHEMA = "finitemonkey/attention@1";

export interface Ask {
  readonly front: string;
  readonly text: string;
  readonly kind: string;
  readonly at: string;
  readonly waitMinutes: number;
  readonly priority: number;
}

export interface AttentionQueue {
  readonly schema: typeof ATTENTION_SCHEMA;
  readonly asks: readonly Ask[];
}

const URGENT_KINDS = new Set(["question", "approval", "decision", "blocked"]);

const priorityOf = (front: Front, kind: string): number => {
  if (front.status === "blocked") return 0;
  return URGENT_KINDS.has(kind) ? 1 : 2;
};

const asksOf = (front: Front, nowMs: number): readonly Ask[] =>
  front.inbox.map((item) => {
    const kind = item.kind ?? "note";
    return {
      front: front.id,
      text: item.text,
      kind,
      at: item.at,
      waitMinutes: Math.max(0, Math.round((nowMs - Date.parse(item.at)) / 60_000)),
      priority: priorityOf(front, kind),
    };
  });

export const orderAsks = (asks: readonly Ask[]): readonly Ask[] =>
  [...asks].sort((a, b) => a.priority - b.priority || a.at.localeCompare(b.at) || a.front.localeCompare(b.front));

export const attentionQueue = (runtime: Runtime, root: AbsolutePath): AttentionQueue => {
  const state = readFronts(runtime, root);
  const nowMs = Date.parse(runtime.now());
  const fronts = state.ok ? state.value.fronts : [];
  return { schema: ATTENTION_SCHEMA, asks: orderAsks(fronts.flatMap((front) => asksOf(front, nowMs))) };
};
