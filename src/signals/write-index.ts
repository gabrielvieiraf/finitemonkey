import type { JsonObject } from "../core/parsed.js";
import { writeJsonFile } from "../task/state.js";
import { indexOf, type SignalScope } from "./context.js";
import type { LoopIndex } from "./loop-index.js";
import { readIndexFile } from "./store.js";

export const INDEX_SCHEMA = "finitemonkey/signals-index@1";

export interface Notice {
  readonly injections: number;
  readonly lastKey: string;
}

export const loopKey = (index: LoopIndex): string =>
  [
    index.error?.sig ?? "",
    String(index.error?.count ?? 0),
    String(index.stalledTurns),
    String(index.repeatedPrompts),
    String(index.undoEdits),
  ].join(":");

export const readNotice = (scope: SignalScope): Notice => {
  const raw = readIndexFile(scope.input.runtime, scope.files);
  if (raw["session"] !== scope.session) return { injections: 0, lastKey: "" };
  const injections = raw["injections"];
  const lastKey = raw["lastKey"];
  return {
    injections: typeof injections === "number" && Number.isInteger(injections) ? injections : 0,
    lastKey: typeof lastKey === "string" ? lastKey : "",
  };
};

const indexJson = (index: LoopIndex): JsonObject => ({
  ...index,
  error: index.error === undefined ? null : { ...index.error },
});

export const writeIndex = (scope: SignalScope, notice: Notice = readNotice(scope)): LoopIndex => {
  const index = indexOf(scope);
  writeJsonFile(scope.input.runtime, scope.files.index, {
    schema: INDEX_SCHEMA,
    session: scope.session,
    at: scope.input.runtime.now(),
    index: indexJson(index),
    injections: notice.injections,
    lastKey: notice.lastKey,
  });
  return index;
};
