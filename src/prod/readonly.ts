import { normalizeCommand } from "../shell/normalize.js";
import type { ShellCommand } from "../shell/types.js";

const READ_PROGRAMS = new Set([
  "cat", "less", "more", "head", "tail", "grep", "egrep", "fgrep", "zgrep", "zcat", "rg", "ls", "ll", "df", "du",
  "free", "uptime", "whoami", "id", "hostname", "uname", "ps", "pgrep", "pidof", "journalctl", "stat", "file", "wc",
  "date", "echo", "pwd", "which", "type", "lsof", "netstat", "ss", "dig", "nslookup", "ping", "top", "htop",
  "vmstat", "iostat", "nproc", "lscpu", "lsblk", "w", "last", "history", "true", "test", "[", "sort", "uniq", "cut",
  "awk", "jq", "dmesg", "tree", "realpath", "readlink", "basename", "dirname", "sha256sum", "md5sum",
]);

const GIT_READ = new Set(["status", "log", "diff", "show", "rev-parse", "describe", "ls-files", "blame", "shortlog"]);
const GIT_LIST = new Set(["remote", "branch", "tag", "stash"]);
const DOCKER_READ = new Set(["ps", "logs", "images", "inspect", "info", "version", "stats", "top", "events", "port", "diff", "history", "ls", "df", "show", "config"]);
const DOCKER_GROUPS = new Set(["container", "image", "compose", "system", "volume", "network", "context", "builder", "node", "service", "stack"]);
const SYSTEMCTL_READ = new Set(["status", "is-active", "is-enabled", "is-failed", "list-units", "list-unit-files", "show", "cat", "list-timers"]);
const KUBECTL_READ = new Set(["get", "describe", "logs", "top", "explain", "version", "api-resources", "api-versions", "cluster-info", "diff", "events", "auth"]);
const HELM_READ = new Set(["list", "ls", "status", "get", "history", "show", "template", "lint", "version", "search", "env"]);
const CURL_WRITE = /^(?:-X|--request|-d|--data.*|-F|--form|-T|--upload-file|-o|--output|-O|--remote-name)$/;

const firstPositional = (args: readonly string[], valueFlags: ReadonlySet<string> = new Set()): readonly string[] => {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-")) {
      if (valueFlags.has(arg)) index += 1;
    } else out.push(arg);
  }
  return out;
};

const DOCKER_VALUE_FLAGS = new Set(["-H", "--host", "-c", "--context", "--config", "-l", "--log-level", "-f", "--file", "-p", "--project-name"]);
const KUBE_VALUE_FLAGS = new Set(["--context", "-n", "--namespace", "--kubeconfig", "--cluster", "--user", "-o", "--output", "-l", "--selector", "-c", "--container", "--kube-context"]);

export const dockerReadOnly = (args: readonly string[]): boolean => {
  const words = firstPositional(args, DOCKER_VALUE_FLAGS);
  const [first, second] = words;
  if (first === undefined) return true;
  if (DOCKER_GROUPS.has(first)) return second === undefined || DOCKER_READ.has(second) || (first === "compose" && second === "top");
  return DOCKER_READ.has(first);
};

export const kubectlReadOnly = (program: string, args: readonly string[]): boolean => {
  const [verb, object] = firstPositional(args, KUBE_VALUE_FLAGS);
  if (verb === undefined) return true;
  if (program === "helm") return HELM_READ.has(verb);
  if (verb === "config") return object === "view" || object === "get-contexts" || object === "current-context";
  if (verb === "rollout") return object === "status" || object === "history";
  return KUBECTL_READ.has(verb);
};

const writesFile = (command: ShellCommand): boolean =>
  command.redirects.some((redirect) => (redirect.op === ">" || redirect.op === ">>" || redirect.op === ">|") && !/^(?:\/dev\/null|&?\d)$/.test(redirect.target) && !redirect.op.startsWith("<"));

const gitReadOnly = (args: readonly string[]): boolean => {
  const [verb, ...rest] = firstPositional(args, new Set(["-C", "-c"]));
  if (verb === undefined) return true;
  if (GIT_READ.has(verb)) return true;
  return GIT_LIST.has(verb) && (rest.length === 0 || (verb === "stash" && rest[0] === "list"));
};

const programReadOnly = (command: ShellCommand): boolean => {
  const { program, args } = command;
  if (program === "git") return gitReadOnly(args);
  if (program === "docker" || program === "docker-compose") return dockerReadOnly(program === "docker-compose" ? ["compose", ...args] : args);
  if (program === "systemctl") return SYSTEMCTL_READ.has(firstPositional(args)[0] ?? "status");
  if (program === "kubectl" || program === "helm") return kubectlReadOnly(program, args);
  if (program === "curl") return !args.some((arg) => CURL_WRITE.test(arg));
  if (program === "find") return !args.some((arg) => arg === "-delete" || arg.startsWith("-exec") || arg.startsWith("-ok"));
  if (program === "sed") return !args.some((arg) => arg.startsWith("-i") || arg === "--in-place");
  if (program === "awk") return !args.some((arg) => arg.includes("system(") || arg.includes(">"));
  return READ_PROGRAMS.has(program);
};

export const readOnlyCommand = (command: ShellCommand): boolean => !writesFile(command) && programReadOnly(command);

export const readOnlyScript = (script: string): boolean => {
  const normalized = normalizeCommand(script);
  return !normalized.incomplete && normalized.commands.every(readOnlyCommand);
};

const SQL_READ = /^\s*(?:select|show|explain|describe|desc|with|\\d\S*|\\l|\\dt|\\x|table)\b/i;
const SQL_WRITE = /\b(?:insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|merge|call|do|vacuum|reindex|cluster|lock|set\s+role)\b/i;

export const readOnlySql = (sql: string): boolean =>
  sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "")
    .every((statement) => SQL_READ.test(statement) && !SQL_WRITE.test(statement));

const REDIS_READ = new Set(["get", "mget", "keys", "scan", "info", "ttl", "pttl", "type", "exists", "strlen", "hget", "hgetall", "hkeys", "lrange", "llen", "smembers", "scard", "zrange", "zcard", "ping", "dbsize", "config"]);

export const readOnlyRedis = (words: readonly string[]): boolean => {
  const [first, second] = words;
  if (first === undefined) return false;
  if (first.toLowerCase() === "config") return (second ?? "").toLowerCase() === "get";
  return REDIS_READ.has(first.toLowerCase());
};
