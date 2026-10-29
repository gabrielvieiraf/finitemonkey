import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { DECISION_FILE } from "../decide/check.js";
import { deny, guardRoot } from "../guards/context.js";
import { applyEdits, editsOf, textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { PLAN_DIR } from "../plan/folder.js";
import { statusOf } from "./record.js";

const WRITERS = new Set(["Write", "Edit", "MultiEdit"]);

const allow: HookDecision = { kind: "allow" };

export const acceptedHold: HookHandler = (input) => {
  const raw = input.payload.raw;
  const args = toolInput(raw);
  const target = textField(args, "file_path");
  if (!WRITERS.has(toolName(raw)) || target === undefined) return allow;
  const root = guardRoot(input);
  const absolute = toAbsolutePath(target, root);
  const file = toPosixPath(relative(root, absolute));
  const name = file.slice(PLAN_DIR.length + 1);
  if (!file.startsWith(`${PLAN_DIR}/`) || !DECISION_FILE.test(name)) return allow;
  const before = input.runtime.readText(absolute);
  const current = before.ok ? before.value : "";
  const content = textField(args, "content");
  const after = content ?? applyEdits(current, editsOf(args));
  if (statusOf(after) !== "accepted" || (before.ok && statusOf(current) === "accepted")) return allow;
  return deny(
    modelReason(input.t, "guardian.block.accepted", { file }),
    input.t("guardian.block.accepted.human", { file }),
  );
};

export const DECISION_HOLD_HANDLERS: HookHandlers = { PreToolUse: [acceptedHold] };
