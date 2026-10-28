import type { AbsolutePath } from "../core/brand.js";
import type { JsonObject } from "../core/parsed.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot, human, sessionCwd } from "../gate/hooks/common.js";
import { maxBlocks, NO_PROGRESS_MAX } from "../gate/hooks/counter.js";
import { readGateStatus } from "../gate/hooks/status.js";
import { textField } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { normalizeLang } from "../i18n/languages.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../task/state.js";
import { type ItemId } from "./blueprints.js";
import { evaluateBlueprint } from "./evaluate.js";
import { findLabels, type Label, type LabelHit } from "./labels.js";
import { itemText } from "./render.js";
import { approvedItems, blueprintOfTask } from "./store.js";
import type { BlueprintType } from "./types.js";
import { projectView } from "./view.js";

export const LABEL_GUARD = "label";

const MINIMUM: Readonly<Record<BlueprintType, Readonly<Record<Label, readonly ItemId[]>>>> = {
  saas: {
    saas: ["api", "database", "auth", "billing"],
    production: ["api", "database", "auth", "secrets", "tests", "environments", "rollback", "logs", "backup"],
    done: ["api", "database", "auth"],
  },
  landing: {
    saas: [],
    production: ["message", "call-to-action", "responsive", "metadata", "domain", "landing-terms"],
    done: ["message", "call-to-action", "responsive"],
  },
};

const SAAS_CORE: readonly ItemId[] = ["api", "database", "auth", "billing"];

const allow = { kind: "allow" } as const;

const taskOf = (input: HookInput, paths: FmPaths): string | undefined => {
  const active = readState(input.runtime, paths).active;
  if (active !== undefined) return active;
  const status = readGateStatus(input.runtime, paths);
  return status?.status === "passed" ? status.task : undefined;
};

interface Verdict {
  readonly hit: LabelHit;
  readonly type: BlueprintType;
  readonly missing: readonly ItemId[];
  readonly green: ReadonlySet<ItemId>;
}

const verdictFor = (input: HookInput, root: AbsolutePath, type: BlueprintType, hits: readonly LabelHit[]) => {
  const view = projectView(input.runtime, root);
  const approved = approvedItems(input.runtime, fmPaths(root));
  const bars = { saas: evaluateBlueprint("saas", view, approved), [type]: evaluateBlueprint(type, view, approved) };
  for (const hit of hits) {
    const blueprint: BlueprintType = hit.label === "saas" ? "saas" : type;
    const required = hit.label === "saas" && type !== "saas" ? SAAS_CORE : MINIMUM[blueprint][hit.label];
    const bar = bars[blueprint] ?? evaluateBlueprint(blueprint, view, approved);
    const green = new Set(bar.items.filter((item) => item.status === "green").map((item) => item.id));
    const missing = required.filter((id) => !green.has(id));
    if (missing.length > 0) return { hit, type, missing, green } satisfies Verdict;
  }
  return undefined;
};

const artifactKey = (verdict: Verdict) => {
  if (verdict.type === "landing") return "planta.label.artifact.landing" as const;
  if (!verdict.green.has("api") && !verdict.green.has("database")) return "planta.label.artifact.screens" as const;
  if (!verdict.green.has("auth")) return "planta.label.artifact.no_accounts" as const;
  return "planta.label.artifact.unfinished" as const;
};

const COUNTER_FILE = "label-guard.json";

const numberAt = (raw: JsonObject | undefined, key: string): number => {
  const value = raw?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
};

const withinCeiling = (input: HookInput, paths: FmPaths, task: string, signature: string): boolean => {
  const raw = input.payload.stopHookActive ? readJsonFile(input.runtime, paths.cache(COUNTER_FILE)) : undefined;
  const sameTask = raw?.["task"] === task;
  const consecutive = (sameTask ? numberAt(raw, "consecutive") : 0) + 1;
  const same = sameTask && raw["signature"] === signature ? numberAt(raw, "same") + 1 : 1;
  if (consecutive > maxBlocks(input.env) || same > NO_PROGRESS_MAX) return false;
  writeJsonFile(input.runtime, paths.cache(COUNTER_FILE), { task, signature, consecutive, same });
  return true;
};

const blockFor = (input: HookInput, paths: FmPaths, task: string, verdict: Verdict): HookDecision => {
  const { t } = input;
  const lang = normalizeLang(t("planta.lang")) ?? "en";
  const artifact = t(artifactKey(verdict));
  const list = verdict.missing.map((id) => itemText(lang, id).title).join("; ");
  const params = {
    label: verdict.hit.label,
    phrase: verdict.hit.phrase,
    artifact,
    list,
    count: verdict.missing.length,
  };
  logEvent(input.runtime, paths, "label.block", { task, label: verdict.hit.label, missing: [...verdict.missing] });
  if (!withinCeiling(input, paths, task, sha256Hex(`label|${verdict.hit.label}|${verdict.missing.join(",")}`))) {
    return { kind: "allow", output: { systemMessage: human(t("planta.label.exhausted", params)) } };
  }
  const reason = t("planta.label.reason", params);
  return {
    kind: "block",
    reason,
    persistent: true,
    output: { decision: "block", reason, systemMessage: human(t("planta.label.human", params)) },
  };
};

export const labelGuard: HookHandler = (input) => {
  const message = textField(input.payload.raw, "last_assistant_message") ?? "";
  const hits = findLabels(message);
  if (hits.length === 0) return allow;
  const root = findRepoRoot(input.runtime, sessionCwd(input));
  if (root === undefined) return allow;
  const paths = fmPaths(root);
  const task = taskOf(input, paths);
  const type = task === undefined ? undefined : blueprintOfTask(input.runtime, paths, task);
  if (task === undefined || type === undefined) return allow;
  const verdict = verdictFor(input, root, type, hits);
  return verdict === undefined ? allow : blockFor(input, paths, task, verdict);
};
