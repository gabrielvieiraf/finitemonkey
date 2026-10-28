import { findRepoRoot, sessionCwd } from "../gate/hooks/common.js";
import { textField } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { BLOCK_HOLD_MS, GATE_HOLD_MS, holdDir, readHold, releaseHold, writeHold } from "./hold.js";

const DETAIL_LIMIT = 400;

const target = (input: HookInput) => {
  const sessionId = input.payload.sessionId;
  const root = findRepoRoot(input.runtime, sessionCwd(input));
  if (sessionId === undefined || root === undefined) return undefined;
  const dir = holdDir(input.runtime, root, input.env);
  return dir === undefined ? undefined : { sessionId, root, dir };
};

export const holdingStop =
  (gate: HookHandler): HookHandler =>
  async (input): Promise<HookDecision> => {
    const where = target(input);
    if (where === undefined) return gate(input);
    const { runtime } = input;
    writeHold(
      runtime,
      where.dir,
      { sessionId: where.sessionId, project: where.root, reason: "gate", detail: "" },
      GATE_HOLD_MS,
    );
    const decision = await gate(input);
    if (decision.kind === "block") {
      const detail = (decision.reason.split("\n")[0] ?? "").slice(0, DETAIL_LIMIT);
      writeHold(
        runtime,
        where.dir,
        { sessionId: where.sessionId, project: where.root, reason: "block", detail },
        BLOCK_HOLD_MS,
      );
    } else releaseHold(runtime, where.dir, where.sessionId);
    return decision;
  };

export const supervisorResume: HookHandler = (input) => {
  if (textField(input.payload.raw, "source") !== "resume") return { kind: "allow" };
  const where = target(input);
  if (where === undefined) return { kind: "allow" };
  const hold = readHold(input.runtime, where.dir, where.sessionId);
  if (hold?.reason !== "block") return { kind: "allow" };
  writeHold(input.runtime, where.dir, { ...hold, reason: "block" }, BLOCK_HOLD_MS);
  input.runtime.spawnSelf(["gate"], where.root);
  const additionalContext = `finitemonkey: ${input.t("supervisor.resumed", { detail: hold.detail })}`;
  return { kind: "allow", output: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } } };
};
