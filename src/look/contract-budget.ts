import type { YamlValue } from "../core/yaml/scalar.js";
import type { TaskSize } from "../task/types.js";

export interface UiBudget {
  readonly screens: number;
  readonly sections: number;
}

export const UI_BUDGET: Readonly<Record<TaskSize, UiBudget>> = {
  S: { screens: 1, sections: 2 },
  M: { screens: 3, sections: 8 },
  L: { screens: Number.POSITIVE_INFINITY, sections: Number.POSITIVE_INFINITY },
};

export const SECTION_ORDER = [
  "primary_action",
  "states",
  "back",
  "tokens",
  "steps_max",
  "forms",
  "dialogs",
  "destructive",
  "terminal",
  "mocks",
] as const;

export interface CappedContract {
  readonly tree: YamlValue;
  readonly dropped: readonly string[];
}

type YamlMap = Readonly<Record<string, YamlValue>>;

const isMap = (value: YamlValue | undefined): value is YamlMap =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const screensOf = (tree: YamlValue): readonly YamlMap[] | undefined => {
  const list = isMap(tree) ? tree["ui"] : undefined;
  return Array.isArray(list) ? list.filter(isMap) : undefined;
};

const nameOf = (screen: YamlMap): string => (typeof screen["screen"] === "string" ? screen["screen"] : "?");

const capScreen = (
  screen: YamlMap,
  room: number,
): { readonly kept: Record<string, YamlValue>; readonly dropped: readonly string[] } => {
  const name = nameOf(screen);
  const present = [
    ...SECTION_ORDER.filter((key) => key in screen),
    ...Object.keys(screen).filter((key) => key !== "screen" && !SECTION_ORDER.some((known) => known === key)),
  ];
  const keep = new Set(present.slice(0, Math.max(0, room)));
  const kept: Record<string, YamlValue> = { screen: name };
  for (const key of present) if (keep.has(key)) kept[key] = screen[key] ?? null;
  return { kept, dropped: present.filter((key) => !keep.has(key)).map((key) => `${name}: ${key}`) };
};

export const capUiContract = (tree: YamlValue, size: TaskSize): CappedContract => {
  const budget = UI_BUDGET[size];
  const screens = screensOf(tree);
  if (screens === undefined || !isMap(tree)) return { tree, dropped: [] };
  const dropped: string[] = screens.slice(budget.screens).map((screen) => `${nameOf(screen)}: screen`);
  let room = budget.sections;
  const kept = screens.slice(0, budget.screens).map((screen) => {
    const capped = capScreen(screen, room);
    room -= Object.keys(capped.kept).length - 1;
    dropped.push(...capped.dropped);
    return capped.kept;
  });
  return { tree: { ...tree, ui: kept }, dropped };
};

export const sectionCount = (tree: YamlValue): number =>
  (screensOf(tree) ?? []).reduce(
    (total, screen) => total + Object.keys(screen).filter((key) => key !== "screen").length,
    0,
  );
