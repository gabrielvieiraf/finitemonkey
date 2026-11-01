import { relative } from "node:path";

import { projectPaths } from "../../gate/hooks/common.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { featureMode, recordFeatureShadow } from "../../policy/feature.js";
import { type ContextFinding, contextFindings, SECRET_CONTEXT_FEATURE } from "../context.js";
import { toolInput, toolName, writtenTexts } from "./tool-input.js";

const ALLOW: HookDecision = { kind: "allow" };

interface Located extends ContextFinding {
  readonly file: string;
}

const located = (input: HookInput): readonly Located[] =>
  writtenTexts(toolName(input.payload), toolInput(input.payload)).flatMap((written) => {
    const file = relative(input.cwd, written.file).split("\\").join("/") || written.file;
    return contextFindings(file, written.text).map((finding) => ({ ...finding, file }));
  });

const describe = (found: readonly Located[]): string =>
  found.map((item) => `${item.name} (${item.file}:${String(item.line)})`).join(", ");

export const secretContextPreToolUse: HookHandler = (input) => {
  const found = located(input);
  if (found.length === 0) return ALLOW;
  const paths = projectPaths(input);
  const mode = paths === undefined ? "shadow" : featureMode(input.runtime, paths, SECRET_CONTEXT_FEATURE);
  if (mode === "off") return ALLOW;
  if (mode === "shadow") {
    if (paths !== undefined) {
      recordFeatureShadow(input.runtime, paths, SECRET_CONTEXT_FEATURE, {
        findings: found.map((item) => ({ name: item.name, file: item.file, line: item.line })),
      });
    }
    return ALLOW;
  }
  return {
    kind: "block",
    reason: modelReason(input.t, "secrets.block.context", { found: describe(found) }),
    human: input.t("secrets.block.human"),
    concept: "secret-in-code",
  };
};
