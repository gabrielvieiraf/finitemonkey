import type { PlanFinding } from "./plan-gate.js";

export interface ComposeVolume {
  readonly name: string;
  readonly driver: string;
  readonly external: boolean;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

const meaningful = (line: string): boolean => line.trim() !== "" && !line.trimStart().startsWith("#");

const topBlock = (lines: readonly string[], key: string): readonly string[] => {
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => meaningful(line) && indentOf(line) === 0);
  return (end < 0 ? rest : rest.slice(0, end)).filter(meaningful);
};

const fieldOf = (text: string, key: string): string | undefined =>
  new RegExp(`(?:^|[\\s{,])${key}:\\s*["']?([\\w./:-]+)`).exec(text)?.[1];

export const composeVolumes = (source: string): readonly ComposeVolume[] => {
  const block = topBlock(source.replace(/\r\n/g, "\n").split("\n"), "volumes");
  const childIndent = block[0] === undefined ? 0 : indentOf(block[0]);
  const volumes: ComposeVolume[] = [];
  let current: { name: string; body: string[] } | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    const body = current.body.join("\n");
    volumes.push({
      name: current.name,
      driver: fieldOf(body, "driver") ?? "local",
      external: fieldOf(body, "external") === "true",
    });
  };
  for (const line of block) {
    const named = indentOf(line) === childIndent ? /^\s*["']?([\w.-]+)["']?:(.*)$/.exec(line) : null;
    if (named?.[1] === undefined) {
      current?.body.push(line);
      continue;
    }
    flush();
    current = { name: named[1], body: [named[2] ?? ""] };
  }
  flush();
  return volumes;
};

export const composeFindings = (before: string, after: string): readonly PlanFinding[] => {
  const now = composeVolumes(after);
  return composeVolumes(before)
    .filter((volume) => !volume.external)
    .flatMap((volume): PlanFinding[] => {
      const kept = now.find((other) => other.name === volume.name);
      if (kept === undefined) return [{ kind: "stateful-destroy", subject: `volume/${volume.name} (delete)` }];
      return kept.driver === volume.driver
        ? []
        : [{ kind: "stateful-destroy", subject: `volume/${volume.name} (replace)` }];
    });
};
