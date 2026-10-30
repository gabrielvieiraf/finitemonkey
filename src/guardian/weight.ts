import { irreversiblePath } from "./irreversible.js";
import { roleOf } from "./roles.js";

export const OPERATED_ROLES: ReadonlySet<string> = new Set(["queue", "cache", "database", "web server"]);

const INFRA: readonly (readonly [string, RegExp])[] = [
  ["containers", /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/],
  ["kubernetes", /(^|\/)(k8s|kubernetes|helm|charts)\//],
  ["terraform", /\.tf$/],
  ["serverless", /(^|\/)serverless\.ya?ml$/],
  ["service", /^(services|apps|packages)\/[^/]+\/package\.json$/],
];

export interface Change {
  readonly addedDeps: readonly string[];
  readonly installedDeps: readonly string[];
  readonly addedFiles: readonly string[];
  readonly changedFiles: readonly string[];
}

export interface SolutionWeight {
  readonly operate: readonly string[];
  readonly newCategories: readonly string[];
  readonly concepts: readonly string[];
  readonly beyond: readonly string[];
  readonly reversibility: "A" | "B";
  readonly newDependencies: number;
  readonly newFiles: number;
  readonly tokens: number;
  readonly evidence: readonly string[];
}

const unique = (items: readonly string[]): readonly string[] => [...new Set(items)];

export const solutionWeight = (change: Change, demonstrated: readonly string[]): SolutionWeight => {
  const before = new Set(change.installedDeps.flatMap((name) => roleOf(name) ?? []));
  const fresh = change.addedDeps.flatMap((name) => {
    const role = roleOf(name);
    return role === undefined || before.has(role) ? [] : [{ name, role }];
  });
  const roles = unique(fresh.map((item) => item.role));
  const files = change.addedFiles.flatMap((file) =>
    INFRA.filter(([, pattern]) => pattern.test(file)).map(([name]) => ({ file, name })),
  );
  const infra = unique(files.map((item) => item.name));
  const operate = [...roles.filter((role) => OPERATED_ROLES.has(role)), ...infra];
  const newCategories = roles.filter((role) => !OPERATED_ROLES.has(role));
  const concepts = unique([...operate, ...newCategories]);
  const known = new Set(demonstrated.map((item) => item.toLowerCase()));
  const beyond = concepts.filter((concept) => !known.has(concept));
  const irreversible = [...change.addedFiles, ...change.changedFiles].some(
    (file) => irreversiblePath(file) !== undefined,
  );
  return {
    operate,
    newCategories,
    concepts,
    beyond,
    reversibility: irreversible || operate.length > 0 ? "B" : "A",
    newDependencies: change.addedDeps.length,
    newFiles: change.addedFiles.length,
    tokens: operate.length + newCategories.length + beyond.length,
    evidence: [
      ...fresh.map((item) => `dependency ${item.name} (${item.role})`),
      ...files.map((item) => `${item.file} (${item.name})`),
    ],
  };
};
