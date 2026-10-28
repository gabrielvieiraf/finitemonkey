import type { MessageKey } from "../i18n/catalogs.js";
import type { Params, Translate } from "../i18n/translate.js";

export const REASON_LIMIT = 10_000;

type Base<K> = K extends `${infer B}.claim` ? B : never;

export type ReasonBase = Base<MessageKey>;

export type ReasonFamily =
  | "secrets.block"
  | "git.block"
  | "prod.block"
  | "prose.block"
  | "creds.block"
  | "rules.block"
  | "gate.guard.bypass"
  | "gate.guard.self"
  | "gate.guard.tests"
  | "gate.guard.rewrite"
  | "fronts.block";

export type HumanFamily = Extract<`${ReasonFamily}.human`, MessageKey>;

const familyOf = (base: ReasonBase): ReasonFamily => {
  const families: readonly ReasonFamily[] = [
    "gate.guard.bypass",
    "gate.guard.self",
    "gate.guard.tests",
    "gate.guard.rewrite",
    "fronts.block",
    "secrets.block",
    "git.block",
    "prod.block",
    "prose.block",
    "creds.block",
    "rules.block",
  ];
  const found = families.find((family) => base.startsWith(`${family}.`) || base === family);
  if (found === undefined) throw new Error(`no reason family for ${base}`);
  return found;
};

export const capReason = (text: string): string =>
  text.length <= REASON_LIMIT ? text : `${text.slice(0, REASON_LIMIT - 1)}…`;

export const modelReason = (t: Translate, base: ReasonBase, params: Params = {}): string => {
  const claim: MessageKey = `${base}.claim`;
  const requires: MessageKey = `${base}.requires`;
  const not: MessageKey = `${familyOf(base)}.not`;
  return capReason(
    [
      `${t("reason.label.blocked")}: ${t(claim, params)}.`,
      `${t("reason.label.requires")}: ${t(requires, params)}.`,
      `${t("reason.label.not")}: ${t(not, params)}.`,
    ].join("\n"),
  );
};

export const humanFamilyKey = (base: ReasonBase): HumanFamily | undefined => {
  const key = `${familyOf(base)}.human`;
  const known: readonly HumanFamily[] = [
    "secrets.block.human",
    "git.block.human",
    "prod.block.human",
    "prose.block.human",
    "fronts.block.human",
    "creds.block.human",
    "rules.block.human",
  ];
  return known.find((candidate) => candidate === key);
};
