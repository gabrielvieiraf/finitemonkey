import { CONFIG_FILE, configAt, type ConfigTree, parseConfigYaml } from "../git/project-config.js";

export const CONVENTION_IDS = ["tests", "lint", "layout"] as const;

export type ConventionId = (typeof CONVENTION_IDS)[number];

export type Conventions = Readonly<Partial<Record<ConventionId, string>>>;

export const CONVENTION_OFF = "off";

const VALUE = /^[a-z][\w.-]{0,39}$/;

export const isConventionValue = (raw: string | undefined): raw is string => raw !== undefined && VALUE.test(raw);

export const conventionsFromTree = (tree: ConfigTree): Conventions =>
  Object.fromEntries(
    CONVENTION_IDS.flatMap((id) => {
      const value = configAt(tree, "conventions", id);
      return typeof value === "string" && isConventionValue(value) ? [[id, value]] : [];
    }),
  );

export const conventionsYaml = (conventions: Conventions | undefined): readonly string[] =>
  CONVENTION_IDS.flatMap((id) => {
    const value = conventions?.[id];
    return value === undefined ? [] : [`  ${id}: ${value}`];
  });

export const adaptedConvention = (
  read: (relative: string) => string | undefined,
  id: ConventionId,
): string | undefined => {
  const text = read(CONFIG_FILE);
  return text === undefined ? undefined : conventionsFromTree(parseConfigYaml(text))[id];
};
