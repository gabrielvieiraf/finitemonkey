import type { AbsolutePath } from "../core/brand.js";
import { globToRegExp } from "../core/glob.js";
import type { Runtime } from "../core/runtime.js";
import { projectPaths } from "../gate/hooks/common.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { effectiveRules } from "./preset.js";
import { defaultBranch } from "./required.js";
import { detectLanguage, type StopFacts, stopFacts } from "./stop-facts.js";
import type { ProjectRule } from "./types.js";
import { recordViolation } from "./violations.js";

export const STOP_CHECKS = ["tests-ran", "typecheck-ran", "default-branch", "language", "scope"] as const;

export type StopCheck = (typeof STOP_CHECKS)[number];

const TEST_COMMAND =
  /\b(test|tests|vitest|jest|pytest|mocha|ava|rspec|phpunit)\b|\bgo test\b|\bcargo test\b|\bnode --test\b/i;
const TYPECHECK_COMMAND = /\btsc\b|type-?check|\bmypy\b|\bpyright\b|\bcargo check\b|\bgo vet\b/i;
const MIN_LANGUAGE_WORDS = 20;

export interface StopContext {
  readonly runtime: Pick<Runtime, "git">;
  readonly root: AbsolutePath;
  readonly facts: StopFacts;
}

const checkOf = (rule: ProjectRule): StopCheck | undefined => {
  const detector = rule.detector;
  return detector?.kind === "check" ? STOP_CHECKS.find((check) => check === detector.check) : undefined;
};

const ranAfterEdit = (facts: StopFacts, pattern: RegExp): string | undefined =>
  facts.edited.length === 0 || facts.commandsAfterEdit.some((command) => pattern.test(command))
    ? undefined
    : facts.edited.slice(0, 3).join(", ");

const committedToDefault = (context: StopContext): string | undefined => {
  const branch = defaultBranch(context.runtime, context.root);
  const head = context.runtime.git(["rev-parse", "--abbrev-ref", "HEAD"], context.root);
  if (!head.ok || head.stdout.trim() !== branch) return undefined;
  const ahead = context.runtime.git(["rev-list", "--count", `origin/${branch}..HEAD`], context.root);
  const count = ahead.ok ? Number.parseInt(ahead.stdout.trim(), 10) : 0;
  return Number.isInteger(count) && count > 0 ? `${String(count)} on ${branch}` : undefined;
};

const wrongLanguage = (facts: StopFacts, wanted: string | undefined): string | undefined => {
  if (wanted === undefined || facts.finalText.split(/\s+/).length < MIN_LANGUAGE_WORDS) return undefined;
  const found = detectLanguage(facts.finalText);
  return found === undefined || found.toLowerCase().startsWith(wanted.toLowerCase().slice(0, 2)) ? undefined : found;
};

const outOfScope = (facts: StopFacts, rule: ProjectRule): string | undefined => {
  if (rule.scope.paths.length === 0) return undefined;
  const allowed = rule.scope.paths.map(globToRegExp);
  const outside = facts.edited.filter((file) => !allowed.some((pattern) => pattern.test(file)));
  return outside.length === 0 ? undefined : outside.slice(0, 3).join(", ");
};

export const stopViolation = (rule: ProjectRule, context: StopContext): string | undefined => {
  switch (checkOf(rule)) {
    case "tests-ran":
      return ranAfterEdit(context.facts, TEST_COMMAND);
    case "typecheck-ran":
      return ranAfterEdit(context.facts, TYPECHECK_COMMAND);
    case "default-branch":
      return committedToDefault(context);
    case "language":
      return wrongLanguage(context.facts, rule.detector?.kind === "check" ? rule.detector.value : undefined);
    case "scope":
      return outOfScope(context.facts, rule);
    case undefined:
      return undefined;
  }
};

export const rulesStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || input.payload.stopHookActive) return { kind: "allow" };
  const rules = effectiveRules(input.runtime, paths.root);
  const stopRules = rules.ok ? rules.value.filter((rule) => rule.bucket === "stop" && checkOf(rule) !== undefined) : [];
  if (stopRules.length === 0) return { kind: "allow" };
  const raw = input.payload.raw;
  const facts = stopFacts(
    input.runtime,
    paths.root,
    textField(raw, "transcript_path"),
    textField(raw, "last_assistant_message"),
  );
  const context: StopContext = { runtime: input.runtime, root: paths.root, facts };
  const broken = stopRules.flatMap((rule) => {
    const detail = stopViolation(rule, context);
    return detail === undefined ? [] : [{ rule, detail }];
  });
  if (broken.length === 0) return { kind: "allow" };
  for (const { rule, detail } of broken)
    recordViolation(input.runtime, paths.dir, {
      session: input.payload.sessionId ?? "",
      rule: rule.id,
      source: "stop",
      detail,
    });
  const list = broken.map(({ rule, detail }) => `${rule.id} (${rule.text}): ${detail}`).join("; ");
  return {
    kind: "block",
    reason: modelReason(input.t, "rules.block.stop", { list }),
    human: input.t("rules.block.stop_human", { count: broken.length }),
  };
};
