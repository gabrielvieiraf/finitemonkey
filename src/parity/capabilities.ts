import type { Git } from "../gate/git.js";
import { grepAt } from "../inventory/grep.js";
import { JOBS, QUEUES, ROUTES, TABLES, TEST_FILE } from "../inventory/patterns.js";
import type { Hit } from "../inventory/types.js";
import { maskText } from "../mask/mask.js";

export interface Capability {
  readonly text: string;
  readonly where: string;
}

const EXPORTS = {
  pattern: "^export +(default +)?(async +)?(function|const|class) +[A-Za-z_$]|^def +[a-z][A-Za-z0-9_]*|^func +[A-Z]",
};

const MAX_TEXT = 100;

export const capabilitiesAt = (git: Git, hash: string, covered: readonly string[]): readonly Capability[] => {
  const hits: readonly Hit[] = [ROUTES, TABLES, QUEUES, JOBS, EXPORTS].flatMap((pattern) =>
    grepAt(git, hash, pattern, covered),
  );
  const seen = new Set<string>();
  return hits
    .filter((hit) => !TEST_FILE.test(hit.file))
    .flatMap((hit) => {
      const text = maskText(hit.text.replace(/\s*\{\s*$/, "")).slice(0, MAX_TEXT);
      if (seen.has(text)) return [];
      seen.add(text);
      return [{ text, where: `${hit.file}:${String(hit.line)}` }];
    });
};
