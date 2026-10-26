import { toAbsolutePath } from "../core/brand.js";
import { accept, optionalString, type Parsed, reject } from "../core/parsed.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { toolInput, toolName } from "../secrets/guards/tool-input.js";
import { projectRoot } from "../secrets/project.js";
import { type CommandProse, proseInCommand, type ProseTarget, type TextSource } from "./command-text.js";
import { describeFixes, describeSpans } from "./describe.js";
import { projectPreset } from "./preset.js";
import { scoreProse } from "./score.js";

const ALLOW: HookDecision = { kind: "allow" };
const SHELLS = new Set(["Bash", "PowerShell"]);

const TARGET_KEYS = {
  commit: "prose.target.commit",
  pr: "prose.target.pr",
  issue: "prose.target.issue",
} as const satisfies Readonly<Record<ProseTarget, MessageKey>>;

interface Unreadable {
  readonly file: string;
  readonly detail: string;
}

const readSource = (input: HookInput, source: TextSource): Parsed<string, Unreadable> => {
  if (source.kind === "inline") return accept(source.text);
  const read = input.runtime.readText(toAbsolutePath(source.path, input.cwd));
  return read.ok ? read : reject({ file: source.path, detail: read.error });
};

const textOf = (input: HookInput, found: CommandProse): Parsed<string, Unreadable> => {
  const parts: string[] = [];
  for (const source of [...(found.title === undefined ? [] : [found.title]), ...found.bodies]) {
    const read = readSource(input, source);
    if (!read.ok) return read;
    parts.push(read.value);
  }
  return accept(parts.join("\n\n"));
};

const decisionFor = (input: HookInput, found: CommandProse, blocking: boolean): HookDecision | undefined => {
  const text = textOf(input, found);
  if (!text.ok) {
    return blocking
      ? {
          kind: "block",
          reason: modelReason(input.t, "prose.block.unreadable", { ...text.error }),
          human: input.t("prose.block.human"),
        }
      : undefined;
  }
  const report = scoreProse(text.value, { context: "record" });
  if (report.allowed || report.spans.length === 0) return undefined;
  const params = {
    target: input.t(TARGET_KEYS[found.target]),
    spans: describeSpans(input.t, report.spans),
    fixes: describeFixes(input.t, report.spans),
  };
  if (blocking)
    return {
      kind: "block",
      reason: modelReason(input.t, "prose.block.command", params),
      human: input.t("prose.block.human"),
    };
  const additionalContext = `finitemonkey: ${input.t("prose.warn.command", params)}`;
  return { kind: "allow", output: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } } };
};

export const proseCommandGuard: HookHandler = (input) => {
  if (!SHELLS.has(toolName(input.payload))) return ALLOW;
  const found = proseInCommand(optionalString(toolInput(input.payload), "command") ?? "");
  if (found.length === 0) return ALLOW;
  const blocking = projectPreset(input.runtime, projectRoot(input)) === "gabriel";
  for (const item of found) {
    const decision = decisionFor(input, item, blocking);
    if (decision !== undefined) return decision;
  }
  return ALLOW;
};
