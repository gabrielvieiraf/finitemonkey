import { textField, toolInput, toolName } from "../../hooks/fields.js";
import type { HookHandler } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { deny, grantFor, SHELL_TOOLS } from "../context.js";
import { detectBypass } from "./detect.js";

export const bypassGuard: HookHandler = (input) => {
  if (!SHELL_TOOLS.has(toolName(input.payload.raw))) return { kind: "allow" };
  const command = textField(toolInput(input.payload.raw), "command") ?? "";
  const findings = detectBypass(command);
  const first = findings[0];
  if (first === undefined || grantFor(input, "bypass") !== undefined) return { kind: "allow" };
  const { t } = input;
  return deny(
    modelReason(t, `gate.guard.bypass.${first.kind}`, { detail: first.detail }),
    t("gate.guard.bypass.human", { detail: first.detail }),
  );
};
