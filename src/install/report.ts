import type { Translate } from "../i18n/translate.js";
import type { Authority } from "./detect.js";
import { lineDiff } from "./diff.js";
import { PLAN_SCHEMA } from "./layout.js";
import type { Detection, Plan, PlanItem } from "./plan.js";

export interface Warning {
  readonly code: string;
  readonly message: string;
}

export interface PlanData {
  readonly schema: typeof PLAN_SCHEMA;
  readonly mode: "init" | "update";
  readonly applied: boolean;
  readonly root: string;
  readonly preset: string;
  readonly detection: JsonDetection;
  readonly actions: readonly { readonly path: string; readonly action: string }[];
  readonly warnings: readonly Warning[];
  readonly diff: readonly string[];
  readonly backup?: string;
}

interface JsonDetection {
  readonly gitRoot: boolean;
  readonly packageManager: string | null;
  readonly languages: readonly string[];
  readonly settings: Detection["settings"];
  readonly authorities: readonly Authority[];
  readonly runner: string;
  readonly claudeVersion: string | null;
  readonly failClosedHooks: boolean;
}

const jsonDetection = (detection: Detection): JsonDetection => ({
  gitRoot: detection.gitRoot,
  packageManager: detection.packageManager ?? null,
  languages: detection.languages,
  settings: detection.settings,
  authorities: detection.authorities,
  runner: detection.runner.kind,
  claudeVersion: detection.claude.version ?? null,
  failClosedHooks: detection.claude.failClosed,
});

const authorityWarning = (t: Translate, authority: Authority): Warning => ({
  code: `authority_${authority.kind}`,
  message: t(`install.warn.${authority.kind === "finitemonkey-plugin" ? "plugin" : "authority"}`, {
    name: authority.name,
    source: authority.source,
  }),
});

const itemWarning = (t: Translate, item: PlanItem): readonly Warning[] => {
  if (item.action === "skip-foreign")
    return [{ code: "foreign_file", message: t("install.warn.foreign", { path: item.path }) }];
  if (item.action === "keep-edited")
    return [{ code: "edited_file", message: t("install.warn.edited", { path: item.path }) }];
  return [];
};

export const planWarnings = (t: Translate, plan: Plan): readonly Warning[] => [
  ...(plan.detection.gitRoot ? [] : [{ code: "not_git", message: t("install.warn.not_git") }]),
  ...(plan.detection.claude.failClosed
    ? []
    : [{ code: "fail_open", message: t("install.warn.fail_open", { version: plan.detection.claude.version ?? "?" }) }]),
  ...plan.detection.authorities.map((authority) => authorityWarning(t, authority)),
  ...plan.items.flatMap((item) => itemWarning(t, item)),
];

export const planDiff = (plan: Plan): readonly string[] =>
  plan.items.flatMap((item) =>
    item.action === "keep-edited" || item.action === "skip-foreign"
      ? lineDiff(item.path, item.before ?? "", item.proposal ?? item.after)
      : lineDiff(item.path, item.before ?? "", item.after),
  );

export const planData = (
  t: Translate,
  plan: Plan,
  mode: PlanData["mode"],
  applied: boolean,
  backup: string | undefined,
): PlanData => ({
  schema: PLAN_SCHEMA,
  mode,
  applied,
  root: plan.detection.root,
  preset: plan.preset,
  detection: jsonDetection(plan.detection),
  actions: plan.items.map(({ path, action }) => ({ path, action })),
  warnings: planWarnings(t, plan),
  diff: planDiff(plan),
  ...(backup === undefined ? {} : { backup }),
});

const pad = (text: string, width: number): string => text.padEnd(width);

export const planLines = (t: Translate, data: PlanData, withDiff: boolean): readonly string[] => [
  t("install.plan.title", { root: data.root, preset: data.preset }),
  ...data.actions.map(({ path, action }) => `  ${pad(action, 13)}${path}`),
  ...data.warnings.map(({ message }) => t("install.warning", { message })),
  ...(withDiff ? data.diff : []),
];
