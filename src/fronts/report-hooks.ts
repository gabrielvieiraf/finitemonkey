import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, optionalString, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { maxBlocks, NO_PROGRESS_MAX } from "../gate/hooks/counter.js";
import { guardRoot } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { checkReport, type ReportCheck, reportSummary } from "./report-gate.js";
import { type Front, readFronts, updateFronts, withFront } from "./state.js";

const ALLOW: HookDecision = { kind: "allow" };
const COUNTER_FILE = ".finitemonkey/cache/front-blocks.json";

interface Counter {
  readonly consecutive: number;
  readonly signature: string;
  readonly same: number;
}

const counterPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, COUNTER_FILE));

const readCounters = (runtime: Runtime, root: AbsolutePath): Readonly<Record<string, Counter>> => {
  const text = runtime.readText(counterPath(root));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return {};
  return Object.fromEntries(
    Object.entries(parsed.value).flatMap(([id, value]): [string, Counter][] =>
      isRecord(value) && typeof value["consecutive"] === "number" && typeof value["same"] === "number"
        ? [[id, { consecutive: value["consecutive"], same: value["same"], signature: String(value["signature"]) }]]
        : [],
    ),
  );
};

const writeCounter = (runtime: Runtime, root: AbsolutePath, id: string, counter: Counter | undefined): void => {
  const all = { ...readCounters(runtime, root) };
  if (counter === undefined) Reflect.deleteProperty(all, id);
  else all[id] = counter;
  runtime.writeText(counterPath(root), `${JSON.stringify(all, null, 2)}\n`);
};

export const frontForInput = (input: HookInput): { readonly root: AbsolutePath; readonly front: Front } | undefined => {
  const root = guardRoot(input);
  const agentId = optionalString(input.payload.raw, "agent_id");
  const state = readFronts(input.runtime, root);
  if (!state.ok || agentId === undefined) return undefined;
  const front = state.value.fronts.find((item) => item.agentId === agentId);
  return front === undefined ? undefined : { root, front };
};

const blocked = (input: HookInput, check: ReportCheck): HookDecision => ({
  kind: "block",
  reason: modelReason(input.t, "fronts.block.report", { front: check.front, problems: check.problems.join("; ") }),
  human: input.t("fronts.block.report_human", { front: check.front }),
});

const markReported = (input: HookInput, root: AbsolutePath, check: ReportCheck): void => {
  updateFronts(input.runtime, root, (state) =>
    accept({
      state: withFront(state, check.front, (front) => ({
        ...front,
        status: "reported",
        lastReport: check.file ?? null,
      })),
      result: undefined,
    }),
  );
};

export const frontReportHandback: HookHandler = (input) => {
  if (toolName(input.payload.raw) !== "SubagentHandback") return ALLOW;
  const found = frontForInput(input);
  if (found === undefined) return ALLOW;
  const check = checkReport(input.runtime, found.root, found.front);
  return check.problems.length === 0 ? ALLOW : blocked(input, check);
};

const nextCounter = (previous: Counter | undefined, check: ReportCheck): Counter => {
  const signature = sha256Hex(check.problems.join("\n"));
  return {
    consecutive: (previous?.consecutive ?? 0) + 1,
    signature,
    same: previous?.signature === signature ? previous.same + 1 : 1,
  };
};

export const frontReportStop: HookHandler = (input) => {
  const found = frontForInput(input);
  if (found === undefined) return ALLOW;
  const { root, front } = found;
  const check = checkReport(input.runtime, root, front);
  if (check.problems.length === 0) {
    writeCounter(input.runtime, root, front.id, undefined);
    markReported(input, root, check);
    return ALLOW;
  }
  const counter = nextCounter(readCounters(input.runtime, root)[front.id], check);
  if (counter.consecutive > maxBlocks(input.env) || counter.same > NO_PROGRESS_MAX) {
    writeCounter(input.runtime, root, front.id, undefined);
    updateFronts(input.runtime, root, (state) =>
      accept({ state: withFront(state, front.id, (item) => ({ ...item, status: "blocked" })), result: undefined }),
    );
    return ALLOW;
  }
  writeCounter(input.runtime, root, front.id, counter);
  return blocked(input, check);
};

export const NOTIFICATION = /<task-notification>|\[SYSTEM NOTIFICATION/;

export const frontNotification: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt") ?? textField(toolInput(input.payload.raw), "prompt") ?? "";
  if (!NOTIFICATION.test(prompt)) return ALLOW;
  const root = guardRoot(input);
  const state = readFronts(input.runtime, root);
  if (!state.ok) return ALLOW;
  const checks = state.value.fronts
    .filter((front) => front.status === "reported" || front.status === "running")
    .map((front) => checkReport(input.runtime, root, front))
    .filter((check) => check.report !== undefined);
  if (checks.length === 0) return ALLOW;
  const lines = checks.map((check) =>
    check.problems.length === 0
      ? input.t("fronts.notify.valid", { summary: reportSummary(check) })
      : input.t("fronts.notify.invalid", { front: check.front, problems: check.problems.join("; ") }),
  );
  return {
    kind: "allow",
    output: { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: lines.join("\n") } },
  };
};
