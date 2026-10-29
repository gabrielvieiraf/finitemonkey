import { textField, toolInput, toolName } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { deny, FILE_TOOLS, grantFor, guardRoot, SHELL_TOOLS } from "../context.js";
import { bashSelfTargets, type SelfKind, selfTarget } from "./protected.js";

const targets = (input: HookInput): readonly { readonly kind: SelfKind; readonly path: string }[] => {
  const tool = toolName(input.payload.raw);
  const args = toolInput(input.payload.raw);
  const root = guardRoot(input);
  if (FILE_TOOLS.has(tool)) {
    const path = textField(args, "file_path", "notebook_path") ?? "";
    const kind = path === "" ? undefined : selfTarget(root, path);
    return kind === undefined ? [] : [{ kind, path }];
  }
  return SHELL_TOOLS.has(tool) ? bashSelfTargets(root, textField(args, "command") ?? "") : [];
};

export const selfGuard: HookHandler = (input): HookDecision => {
  const found = targets(input);
  const store = found.find((item) => item.kind === "allow_store");
  const registry = found.find((item) => item.kind === "registry");
  const { t } = input;
  if (registry !== undefined)
    return deny(
      modelReason(t, "gate.guard.self.registry", { file: registry.path }),
      t("gate.guard.self.human", { file: registry.path }),
    );
  if (store !== undefined)
    return deny(
      modelReason(t, "gate.guard.self.allow_store", { file: store.path }),
      t("gate.guard.self.human", { file: store.path }),
    );
  const first = found[0];
  if (first === undefined || grantFor(input, "self") !== undefined) return { kind: "allow" };
  if (first.kind === "examples")
    return deny(modelReason(t, "gate.guard.self.examples", { file: first.path }), t("gate.guard.examples.human"));
  if (first.kind === "trust")
    return deny(modelReason(t, "gate.guard.self.trust", { file: first.path }), t("gate.guard.trust.human"));
  if (first.kind === "amend")
    return deny(modelReason(t, "gate.guard.self.amend", { file: first.path }), t("gate.guard.amend.human"));
  return deny(
    modelReason(t, "gate.guard.self.policy", { file: first.path }),
    t("gate.guard.self.human", { file: first.path }),
  );
};
