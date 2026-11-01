import { manifestResources, type PlanFinding, removedStateful } from "./plan-gate.js";

const IMMUTABLE_FIELDS = ["serviceName", "selector", "volumeClaimTemplates", "podManagementPolicy"] as const;

const indentOf = (line: string): number => line.length - line.trimStart().length;

const meaningful = (line: string): boolean => line.trim() !== "" && !line.trimStart().startsWith("#");

const childBlock = (lines: readonly string[], key: string, indent: number): readonly string[] => {
  const start = lines.findIndex((line) => indentOf(line) === indent && line.trimStart().startsWith(`${key}:`));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => meaningful(line) && indentOf(line) <= indent);
  return [lines[start] ?? "", ...(end < 0 ? rest : rest.slice(0, end))].filter(meaningful);
};

const immutableSignature = (document: string): string => {
  const spec = childBlock(document.split("\n"), "spec", 0).slice(1);
  const indent = spec[0] === undefined ? 0 : indentOf(spec[0]);
  return IMMUTABLE_FIELDS.map((field) =>
    childBlock(spec, field, indent)
      .map((line) => line.trim())
      .join("\n"),
  ).join("\n--\n");
};

interface StatefulSetDoc {
  readonly name: string;
  readonly signature: string;
}

const statefulSets = (source: string): readonly StatefulSetDoc[] =>
  source
    .replace(/\r\n/g, "\n")
    .split(/^---\s*$/m)
    .flatMap((document) => {
      const [resource] = manifestResources(document);
      return resource?.kind === "StatefulSet" ? [{ name: resource.name, signature: immutableSignature(document) }] : [];
    });

export const replacedStateful = (before: string, after: string): readonly PlanFinding[] => {
  const now = statefulSets(after);
  return statefulSets(before).flatMap((set): PlanFinding[] => {
    const kept = now.find((other) => other.name === set.name);
    return kept === undefined || kept.signature === set.signature
      ? []
      : [{ kind: "stateful-destroy", subject: `StatefulSet/${set.name} (replace)` }];
  });
};

export const manifestChanges = (before: string, after: string): readonly PlanFinding[] => [
  ...removedStateful(manifestResources(before), manifestResources(after)),
  ...replacedStateful(before, after),
];
