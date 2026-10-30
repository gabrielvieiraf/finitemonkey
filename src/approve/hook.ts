import type { Runtime } from "../core/runtime.js";
import { human, projectPaths } from "../gate/hooks/common.js";
import { shellText } from "../git/hooks/context.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { readProfile } from "../perfil/store.js";
import { type Domain, levelOf } from "../perfil/types.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { toolName } from "../secrets/guards/tool-input.js";
import { dialectOf, normalizeCommand } from "../shell/normalize.js";
import { domainOfText, GENERAL } from "../signals/blind-band.js";
import type { FmPaths } from "../task/paths.js";
import { explainCommands, type Explained } from "./effect.js";

export const EXPLAIN_APPROVAL_FEATURE = "explain-approval";

export type Phrasing = "short" | "long";

const effectText = (t: Translate, explained: Explained): string => {
  const { effect, host } = explained;
  if (host !== undefined && (effect === "sends" || effect === "reads"))
    return t(`approve.effect.${effect}_host`, { host });
  return t(`approve.effect.${effect}`);
};

export const approvalLine = (t: Translate, explained: Explained, phrasing: Phrasing): string =>
  t(`approve.line.${phrasing}`, {
    effect: effectText(t, explained),
    reversal: t(`approve.reversal.${explained.reversal}`),
  });

export const phrasingFor = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths, text: string): Phrasing => {
  const found = domainOfText(text);
  const domain: Domain = found === GENERAL ? "infrastructure" : found;
  const knowledge = readProfile(runtime, paths)?.domains[domain].knowledge;
  return knowledge !== undefined && levelOf(knowledge) === "advanced" ? "short" : "long";
};

export const explainApproval: HookHandler = (input) => {
  const text = shellText(input.payload);
  const paths = projectPaths(input);
  if (text === undefined || paths === undefined) return { kind: "allow" };
  const commands = normalizeCommand(text, dialectOf(toolName(input.payload))).commands;
  const explained = explainCommands(commands, { cwd: input.cwd, repoRoot: paths.root });
  const line = approvalLine(input.t, explained, phrasingFor(input.runtime, paths, text));
  if (featureMode(input.runtime, paths, EXPLAIN_APPROVAL_FEATURE) !== "active") {
    recordFeatureShadow(input.runtime, paths, EXPLAIN_APPROVAL_FEATURE, {
      effect: explained.effect,
      reversal: explained.reversal,
      host: explained.host ?? null,
      command: sha256Hex(text).slice(0, 16),
      line,
    });
    return { kind: "allow" };
  }
  return { kind: "allow", output: { systemMessage: human(line) } };
};

export const EXPLAIN_APPROVAL_HANDLERS: HookHandlers = { PermissionRequest: [explainApproval] };
