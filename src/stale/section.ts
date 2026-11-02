import type { Mention } from "./touched.js";

export const SECTION_LIMIT = 20;

export const mentionLine = (mention: Mention): string =>
  `- [ ] \`${mention.file}:${String(mention.line)}\` mentions ${mention.mentions.map((item) => `\`${item}\``).join(", ")}${mention.changedHere ? " (changed in this PR)" : ""}: ${mention.says.replace(/\|/g, "\\|")}`;

export const staleSection = (mentions: readonly Mention[], base: string): readonly string[] => {
  if (mentions.length === 0) return [];
  const shown = mentions.slice(0, SECTION_LIMIT);
  const rest = mentions.length - shown.length;
  return [
    "## What this change makes stale",
    "",
    "Docs that mention files, symbols, flags or issues this diff touched. Update them here if they no longer hold.",
    "",
    ...shown.map(mentionLine),
    ...(rest > 0 ? [`- ${String(rest)} more: \`finitemonkey stale --diff ${base}\``] : []),
    "",
  ];
};
