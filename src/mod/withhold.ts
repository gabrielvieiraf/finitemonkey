import type { ModApi } from "./api.js";
import { runCli } from "./cli.js";
import type { PromptComposeResult } from "./events.js";
import { memory } from "./memory.js";

export const RULES_ARM = "rules-section";

const SECTION_PATTERNS: Readonly<Record<string, RegExp>> = {
  "agents-md": /agents[._-]?md/i,
  "claude-md": /claude[._-]?md/i,
  "native-memory": /(?:^|[^a-z])(?:auto[._-]?)?memory(?:[^a-z]|$)/i,
};

export interface Drop {
  readonly source: string;
  readonly section: string | undefined;
}

export interface Withheld {
  readonly result: PromptComposeResult;
  readonly drops: readonly Drop[];
}

export const sourceOfSection = (id: string, withhold: readonly string[]): string | undefined =>
  withhold.find((source) => SECTION_PATTERNS[source]?.test(id) === true);

export const withholdSections = (result: PromptComposeResult, withhold: readonly string[]): Withheld => {
  const matched = result.sections.flatMap((section) => {
    const source = sourceOfSection(section.id, withhold);
    return source === undefined ? [] : [{ source, section: section.id }];
  });
  const dropped = new Set(matched.map((drop) => drop.section));
  const missing = withhold
    .filter((source) => source !== RULES_ARM && !matched.some((drop) => drop.source === source))
    .map((source) => ({ source, section: undefined }));
  return {
    result: { sections: result.sections.filter((section) => !dropped.has(section.id)) },
    drops: [...matched, ...missing],
  };
};

const keyOf = (drop: Drop): string => `${drop.source}\u0000${drop.section ?? ""}`;

export function reportDrops($: ModApi, drops: readonly Drop[]): void {
  const fresh = drops.filter((drop) => !memory.dropped.includes(keyOf(drop)));
  if (fresh.length === 0) return;
  memory.dropped = [...memory.dropped, ...fresh.map(keyOf)];
  for (const drop of fresh) {
    const section = drop.section === undefined ? [] : ["--section", drop.section];
    $.clock.after(0, async () => {
      await runCli($, ["mod", "drop", "--source", drop.source, ...section]);
    });
  }
}
