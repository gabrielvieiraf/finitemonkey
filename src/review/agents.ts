export const REVIEW_AGENTS = ["reviewer", "verifier"] as const;

export type ReviewAgent = (typeof REVIEW_AGENTS)[number];

export const FORBIDDEN_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Agent", "Task"] as const;

export const reviewAgentOf = (agentType: string): ReviewAgent | undefined =>
  REVIEW_AGENTS.find((name) => agentType === name || agentType.endsWith(`:${name}`));

export interface AgentSpec {
  readonly name: ReviewAgent;
  readonly description: string;
  readonly tools: readonly string[];
  readonly model: string;
  readonly maxTurns: number;
  readonly mcpServers?: readonly string[];
  readonly body: string;
}

const REVIEWER_BODY = [
  "# Reviewer",
  "",
  "You review a change you did not write. Your input is the review packet in your prompt: the diff, the task contract, the evidence ledger and, when present, the code owners' REVIEW.md. You never see the conversation that produced the change, and you must not ask for it.",
  "",
  "1. Read the diff first, then open the files it touches when you need context.",
  "2. Judge the change against the contract: does each acceptance check have evidence for the current tree?",
  "3. Write numbered findings in three groups: must fix, should fix, nice to have. For each: what it is, the problem, the fix, and what happens if it is not fixed.",
  "4. Every must-fix finding carries a reproduction command and the expected result. A finding without one goes under should fix.",
  "5. End with a verdict: approve, approve with changes, or request changes.",
  "",
  "You cannot edit files or start other agents. Report; do not repair.",
].join("\n");

const VERIFIER_BODY = [
  "# Verifier",
  "",
  "You check claims with commands, not with opinions. Your input is the review packet and, when there is one, the reviewer's must-fix findings with their reproduction commands. You never see the conversation that produced the change.",
  "",
  "1. Run each reproduction command in a throwaway worktree on the base commit and on the head commit (`git worktree add <tmp> <rev>`), never in the person's working tree.",
  "2. Record both exit codes. Fails only on head: the finding stands. Fails on both: it was already there. Fails on neither: not reproduced.",
  "3. Report one line per finding with the command and both results, then remove the worktrees.",
  "",
  "You cannot edit files or start other agents. Report; do not repair.",
].join("\n");

export const REVIEWER: AgentSpec = {
  name: "reviewer",
  description:
    "Read-only reviewer for a finished change. Give it the output of `finitemonkey review packet`, never the conversation.",
  tools: ["Read", "Grep", "Glob"],
  model: "opus",
  maxTurns: 40,
  body: REVIEWER_BODY,
};

export const VERIFIER: AgentSpec = {
  name: "verifier",
  description:
    "Runs reproduction commands from a review on the base and head commits in throwaway worktrees and reports which findings are real. Read-only.",
  tools: ["Read", "Grep", "Glob", "Bash"],
  model: "sonnet",
  maxTurns: 60,
  body: VERIFIER_BODY,
};

export const PLAYWRIGHT_SERVER = "playwright";

export const withPlaywright = (spec: AgentSpec): AgentSpec => ({
  ...spec,
  tools: [...spec.tools, `mcp__${PLAYWRIGHT_SERVER}`],
  mcpServers: [PLAYWRIGHT_SERVER],
});

export const agentMarkdown = (spec: AgentSpec, marker?: string): string =>
  [
    "---",
    `name: ${spec.name}`,
    `description: ${spec.description}`,
    `tools: ${spec.tools.join(", ")}`,
    `disallowedTools: ${FORBIDDEN_TOOLS.join(", ")}`,
    `model: ${spec.model}`,
    "effort: high",
    `maxTurns: ${String(spec.maxTurns)}`,
    ...(spec.mcpServers === undefined ? [] : ["mcpServers:", ...spec.mcpServers.map((name) => `  - ${name}`)]),
    "---",
    "",
    ...(marker === undefined ? [] : [`<!-- ${marker} -->`, ""]),
    spec.body,
    "",
  ].join("\n");
