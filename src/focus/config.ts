import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configMap, type ConfigTree, parseConfigYaml } from "../git/project-config.js";
import { policyPath } from "../policy/policy.js";

export const PERSON_SECTION = "person";

export interface PersonConfig {
  readonly projectLimit: number;
  readonly idleMinutes: number;
}

export const DEFAULT_PERSON: PersonConfig = { projectLimit: 3, idleMinutes: 30 };

const whole = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return raw !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
};

export const parsePerson = (tree: ConfigTree): PersonConfig => {
  const raw = configMap(tree, PERSON_SECTION);
  return {
    projectLimit: whole(raw["projectLimit"], DEFAULT_PERSON.projectLimit),
    idleMinutes: whole(raw["idleMinutes"], DEFAULT_PERSON.idleMinutes),
  };
};

export const loadPerson = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): PersonConfig => {
  const text = runtime.readText(policyPath(root));
  return text.ok ? parsePerson(parseConfigYaml(text.value)) : DEFAULT_PERSON;
};
