export interface UnitRefs {
  readonly issues: readonly number[];
  readonly commands: readonly string[];
  readonly features: readonly string[];
}

const ISSUE = /(?<![\w/&])#(\d{1,6})\b/g;
const COMMAND = /\b(?:finitemonkey|fm)\s+([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})/g;
const TICKED = /`([a-z][a-z0-9-]*)`/g;

const unique = <T>(items: readonly T[]): readonly T[] => [...new Set(items)];

export const longestCommand = (words: string, commands: ReadonlySet<string>): string | undefined => {
  const parts = words.split(/\s+/);
  for (let size = parts.length; size > 0; size -= 1) {
    const candidate = parts.slice(0, size).join(" ");
    if (commands.has(candidate)) return candidate;
  }
  return undefined;
};

export const refsOf = (text: string, commands: ReadonlySet<string>, features: ReadonlySet<string>): UnitRefs => ({
  issues: unique([...text.matchAll(ISSUE)].map((match) => Number(match[1]))),
  commands: unique(
    [...text.matchAll(COMMAND)].flatMap((match) => {
      const found = longestCommand(match[1] ?? "", commands);
      return found === undefined ? [] : [found];
    }),
  ),
  features: unique([...text.matchAll(TICKED)].map((match) => match[1] ?? "").filter((id) => features.has(id))),
});
