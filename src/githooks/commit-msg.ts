export const COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export const MAX_HEADER = 100;

export type CommitProblem = "header" | "header_length" | "attribution";

const HEADER = new RegExp(`^(?:${COMMIT_TYPES.join("|")})(?:\\([^()\\r\\n]+\\))?!?: \\S`);

const EXEMPT = /^(?:Merge |Revert "|fixup! |squash! |amend! |Initial commit$)/;

const AI_NAMES = /claude|anthropic|copilot|chatgpt|openai|cursor|gemini|codex|devin|aider/i;

const ATTRIBUTION: readonly RegExp[] = [
  /^co-authored-by:.*$/gim,
  /generated (?:with|by) \[?(?:claude|copilot|chatgpt|cursor|gemini|codex)/i,
  /🤖 generated/i,
  /claude\.ai\/code\//i,
];

const meaningful = (message: string): readonly string[] =>
  message
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("#"));

const hasAttribution = (body: string): boolean => {
  const [coAuthor, ...rest] = ATTRIBUTION;
  const coAuthors = coAuthor === undefined ? [] : (body.match(coAuthor) ?? []);
  return coAuthors.some((line) => AI_NAMES.test(line)) || rest.some((pattern) => pattern.test(body));
};

export const commitMessageProblems = (message: string): readonly CommitProblem[] => {
  const lines = meaningful(message);
  const header = lines.find((line) => line.trim() !== "") ?? "";
  const problems: CommitProblem[] = [];
  if (!EXEMPT.test(header) && !HEADER.test(header)) problems.push("header");
  if (header.length > MAX_HEADER) problems.push("header_length");
  if (hasAttribution(lines.join("\n"))) problems.push("attribution");
  return problems;
};
