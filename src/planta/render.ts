import type { Lang } from "../i18n/languages.js";
import type { Translate } from "../i18n/translate.js";
import { BLUEPRINTS, type ItemId } from "./blueprints.js";
import type { BlueprintBar, ItemResult } from "./evaluate.js";
import { BLUEPRINT_TEXT } from "./text/index.js";
import type { ItemText } from "./text/types.js";
import type { BlueprintType, Probe } from "./types.js";

export const itemText = (lang: Lang, id: ItemId): ItemText => BLUEPRINT_TEXT[lang][id];

export const typeLabel = (t: Translate, type: BlueprintType): string =>
  type === "saas" ? t("planta.type.saas") : t("planta.type.landing");

export const howChecked = (t: Translate, id: ItemId, probe: Probe): string => {
  switch (probe.type) {
    case "files":
      return t("planta.how.files", { list: probe.any.join(", ") });
    case "grep":
      return t("planta.how.grep", { list: probe.all.join(" + ") });
    case "deps":
      return t("planta.how.deps", { list: probe.any.join(", ") });
    case "contract":
      return t("planta.how.contract", { kind: probe.kind });
    case "manual":
      return t("planta.how.manual", { id });
  }
};

const probeOf = (type: BlueprintType, id: ItemId): Probe | undefined =>
  BLUEPRINTS[type].find((item) => item.id === id)?.probe;

const MARK: Readonly<Record<ItemResult["status"], string>> = { green: "✓", missing: "✗", manual: "·" };

export const barLine = (t: Translate, bar: Pick<BlueprintBar, "type" | "green" | "total">): string =>
  t("planta.bar", { label: typeLabel(t, bar.type), green: bar.green, total: bar.total });

export const barLines = (t: Translate, lang: Lang, bar: BlueprintBar): readonly string[] => {
  const next = bar.next;
  const nextProbe = next === undefined ? undefined : probeOf(bar.type, next);
  const nextLines =
    next === undefined || nextProbe === undefined
      ? []
      : [
          t("planta.next", { title: itemText(lang, next).title, id: next }),
          `  ${itemText(lang, next).why}`,
          `  ${t("planta.minimum", { text: itemText(lang, next).minimum })}`,
          `  ${howChecked(t, next, nextProbe)}`,
        ];
  return [
    barLine(t, bar),
    ...nextLines,
    ...bar.items.map((item) => `${MARK[item.status]} ${item.id}: ${itemText(lang, item.id).title}`),
  ];
};
