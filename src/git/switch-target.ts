import type { GitFacts } from "./facts.js";
import type { GitInvocation } from "./invocation.js";

const CREATES = new Set(["-c", "-C", "-b", "-B", "--create", "--force-create", "--orphan"]);

const operands = (args: readonly string[]): readonly string[] | undefined => {
  if (args.includes("--")) return undefined;
  return args.filter((arg) => !arg.startsWith("-"));
};

export const switchTarget = (invocation: GitInvocation, facts: GitFacts): string | undefined => {
  if (invocation.subcommand !== "switch" && invocation.subcommand !== "checkout") return undefined;
  const created = invocation.args.findIndex((arg) => CREATES.has(arg));
  if (created >= 0) return invocation.args[created + 1];
  const names = operands(invocation.args);
  const [name] = names ?? [];
  if (names?.length !== 1 || name === undefined) return undefined;
  return invocation.subcommand === "switch" || facts.branchExists(name) ? name : undefined;
};
