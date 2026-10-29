import { isWithin, resolveFrom } from "../git/path-key.js";
import { removalTargets } from "../git/rm-guard.js";
import type { ShellCommand } from "../shell/types.js";

export const EFFECTS = ["reads", "changes", "deletes", "sends", "unknown"] as const;
export const REVERSALS = ["self", "undo", "none", "unknown"] as const;

export type Effect = (typeof EFFECTS)[number];
export type Reversal = (typeof REVERSALS)[number];

export interface Explained {
  readonly effect: Effect;
  readonly reversal: Reversal;
  readonly host?: string;
}

export interface EffectContext {
  readonly cwd: string;
  readonly repoRoot: string | undefined;
}

const READERS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "wc",
  "pwd",
  "echo",
  "which",
  "type",
  "file",
  "stat",
  "du",
  "df",
  "diff",
  "tree",
  "get-content",
  "get-childitem",
  "select-string",
]);
const CHANGERS = new Set(["mkdir", "touch", "cp", "mv", "chmod", "ln", "tsc", "make", "new-item", "copy-item"]);
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "node", "python", "python3", "pip", "cargo", "go"]);
const SENDERS = new Set(["ssh", "scp", "sftp"]);
const FETCHERS = new Set(["curl", "wget", "invoke-webrequest", "invoke-restmethod", "iwr", "irm"]);
const GIT_READS = new Set(["status", "log", "diff", "show", "blame", "rev-parse", "ls-files", "grep", "describe"]);
const GIT_SENDS = new Set(["push"]);
const PUBLISHERS = new Set(["publish"]);
const SEND_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DATA_FLAGS = /^(?:-d|--data(?:-\w+)?|-F|--form|-T|--upload-file|--json|-Body|-InFile)(?:=|$)/i;
const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|0\.0\.0\.0)$/i;

const RANK: Readonly<Record<Effect, number>> = { reads: 0, changes: 1, deletes: 2, sends: 3, unknown: 4 };

const UNKNOWN: Explained = { effect: "unknown", reversal: "unknown" };

const hostOf = (args: readonly string[]): string | undefined => {
  for (const arg of args) {
    const match = /^(?:[a-z][\w+.-]*:\/\/)(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(arg);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  return undefined;
};

const methodOf = (args: readonly string[]): string | undefined => {
  const index = args.findIndex((arg) => arg === "-X" || arg === "--request" || /^-Method$/i.test(arg));
  const inline = args.find((arg) => /^(?:-X|--request=)\w+$/.test(arg) && arg !== "-X");
  const value = index >= 0 ? args[index + 1] : inline?.replace(/^(?:-X|--request=)/, "");
  return value?.toUpperCase();
};

const fetchEffect = (command: ShellCommand): Explained => {
  const host = hostOf(command.args);
  if (host === undefined) return UNKNOWN;
  const method = methodOf(command.args);
  const sends = command.args.some((arg) => DATA_FLAGS.test(arg)) || (method !== undefined && SEND_METHODS.has(method));
  if (!sends) return { effect: "reads", reversal: "self", host };
  return LOCAL_HOST.test(host)
    ? { effect: "changes", reversal: "none", host }
    : { effect: "sends", reversal: "none", host };
};

const remoteOf = (args: readonly string[]): string | undefined => {
  const target = args.find((arg) => !arg.startsWith("-") && /^(?:[^@/\s]+@)?[\w.-]+:/.test(arg));
  return target?.replace(/^[^@]*@/, "").split(":")[0];
};

const gitEffect = (command: ShellCommand): Explained => {
  const sub = command.args.find((arg) => !arg.startsWith("-"));
  if (sub === undefined) return UNKNOWN;
  if (GIT_READS.has(sub)) return { effect: "reads", reversal: "self" };
  if (GIT_SENDS.has(sub)) {
    const remote = command.args.filter((arg) => !arg.startsWith("-"))[1];
    return remote === undefined
      ? { effect: "sends", reversal: "none" }
      : { effect: "sends", reversal: "none", host: remote };
  }
  return { effect: "changes", reversal: "unknown" };
};

const insideRepo = (command: ShellCommand, context: EffectContext, targets: readonly string[]): boolean => {
  const root = context.repoRoot;
  if (root === undefined || targets.length === 0) return false;
  return targets.every(
    (target) => !target.startsWith("$") && isWithin(resolveFrom(context.cwd, command.dir, target), root),
  );
};

const removalEffect = (command: ShellCommand, context: EffectContext): Explained | undefined => {
  if (!["rm", "rmdir", "remove-item", "del", "unlink"].includes(command.program)) return undefined;
  const targets = removalTargets(command);
  if (targets === undefined) return { effect: "deletes", reversal: "none" };
  return { effect: "deletes", reversal: insideRepo(command, context, targets) ? "undo" : "none" };
};

const runnerEffect = (command: ShellCommand): Explained => {
  const sub = command.args.find((arg) => !arg.startsWith("-"));
  if (sub !== undefined && PUBLISHERS.has(sub)) return { effect: "sends", reversal: "none" };
  return { effect: "changes", reversal: "none" };
};

const findEffect = (command: ShellCommand): Explained => {
  if (command.args.some((arg) => arg === "-delete")) return { effect: "deletes", reversal: "none" };
  if (command.args.some((arg) => arg.startsWith("-exec") || arg.startsWith("-ok"))) return UNKNOWN;
  return { effect: "reads", reversal: "self" };
};

const sedEffect = (command: ShellCommand): Explained =>
  command.args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place"))
    ? { effect: "changes", reversal: "none" }
    : { effect: "reads", reversal: "self" };

const rsyncEffect = (command: ShellCommand): Explained => {
  const host = remoteOf(command.args.slice(-1));
  return host === undefined ? { effect: "changes", reversal: "none" } : { effect: "sends", reversal: "none", host };
};

const programEffect = (command: ShellCommand, context: EffectContext): Explained => {
  const removal = removalEffect(command, context);
  if (removal !== undefined) return removal;
  const { program } = command;
  if (program === "git") return gitEffect(command);
  if (program === "find") return findEffect(command);
  if (program === "sed") return sedEffect(command);
  if (FETCHERS.has(program)) return fetchEffect(command);
  if (SENDERS.has(program)) {
    const host = remoteOf(command.args);
    return host === undefined ? { effect: "sends", reversal: "none" } : { effect: "sends", reversal: "none", host };
  }
  if (program === "rsync") return rsyncEffect(command);
  if (READERS.has(program)) return { effect: "reads", reversal: "self" };
  if (CHANGERS.has(program)) return { effect: "changes", reversal: "none" };
  if (RUNNERS.has(program)) return runnerEffect(command);
  return UNKNOWN;
};

const withRedirects = (command: ShellCommand, found: Explained): Explained => {
  const writes = command.redirects.some((item) => item.op.includes(">") && !/^\/dev\/null$/i.test(item.target));
  if (!writes || RANK[found.effect] >= RANK.changes) return found;
  return { effect: "changes", reversal: "none" };
};

export const commandEffect = (command: ShellCommand, context: EffectContext): Explained =>
  command.dynamic ? UNKNOWN : withRedirects(command, programEffect(command, context));

const REVERSAL_RANK: Readonly<Record<Reversal, number>> = { self: 0, undo: 1, unknown: 2, none: 3 };

const worse = (left: Explained, right: Explained): Explained => {
  const effect = RANK[right.effect] > RANK[left.effect] ? right.effect : left.effect;
  const reversal = REVERSAL_RANK[right.reversal] > REVERSAL_RANK[left.reversal] ? right.reversal : left.reversal;
  const host = RANK[right.effect] >= RANK[left.effect] ? (right.host ?? left.host) : (left.host ?? right.host);
  if (effect === "unknown") return UNKNOWN;
  return host === undefined ? { effect, reversal } : { effect, reversal, host };
};

export const explainCommands = (commands: readonly ShellCommand[], context: EffectContext): Explained => {
  const found = commands.map((command) => commandEffect(command, context));
  const first = found[0];
  if (first === undefined) return UNKNOWN;
  return found.slice(1).reduce(worse, first);
};
