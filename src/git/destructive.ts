import { basename, join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { lexBash } from "../shell/lexer.js";
import { lexPowerShell } from "../shell/powershell.js";
import type { Dialect, ShellCommand, Token } from "../shell/types.js";

export type DestructiveRule = "sql-destroy" | "terraform-destroy" | "kubectl-delete" | "pipe-shell";

export interface DestructiveHit {
  readonly rule: DestructiveRule;
  readonly subject: string;
}

export interface DestructiveContext {
  readonly runtime: Pick<Runtime, "readText">;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const FETCHERS = new Set(["curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "iex", "invoke-expression"]);
const WRAPPERS = new Set(["sudo", "doas", "env", "command", "exec", "nohup"]);

const programOf = (words: readonly string[]): string => {
  const word = words.find((item) => !WRAPPERS.has(item) && !item.startsWith("-") && !/^\w+=/.test(item)) ?? "";
  return basename(word.replace(/\\/g, "/"))
    .toLowerCase()
    .replace(/\.exe$/, "");
};

const END: Token = { kind: "op", text: "\n" };

export const pipeToShell = (text: string, dialect: Dialect): string | undefined => {
  const tokens: readonly Token[] = (dialect === "powershell" ? lexPowerShell(text) : lexBash(text)).tokens;
  let words: string[] = [];
  let previous: { readonly program: string; readonly op: string } | undefined;
  for (const token of [...tokens, END]) {
    if (token.kind === "word") words.push(token.text);
    if (token.kind !== "op") continue;
    const program = programOf(words);
    if (previous?.op === "|" && FETCHERS.has(previous.program) && SHELLS.has(program)) {
      return `${previous.program} | ${program}`;
    }
    previous = { program, op: token.text };
    words = [];
  }
  return undefined;
};

const SQL_CLIENTS = new Set(["psql", "mysql", "mariadb", "sqlcmd", "clickhouse-client", "cockroach", "pgcli", "mycli"]);
export const SQL_DESTROY =
  /\bdrop\s+(?:table|database|schema)\b|\btruncate\b|\bdelete\s+from\s+[\w."`[\]]+\s*(?:;|$)/im;
export const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|0\.0\.0\.0|host\.docker\.internal)$/i;
const HOST_FLAGS = new Set(["-h", "--host", "-S", "--server"]);

export const hostOfUrl = (value: string): string | undefined => {
  const match = /^[a-z][\w+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?,]+)/i.exec(value);
  return match?.[1];
};

const sqlHosts = (command: ShellCommand): readonly string[] => {
  const hosts: string[] = [];
  command.args.forEach((arg, index) => {
    const url = hostOfUrl(arg.replace(/^--?[\w-]+=/, ""));
    if (url !== undefined) hosts.push(url);
    else if (arg.includes("$") && /url|uri|dsn|database|conn/i.test(arg)) hosts.push(arg);
    if (HOST_FLAGS.has(arg)) hosts.push(command.args[index + 1] ?? "");
    const inline = /^(?:--host=|-h(?=\S))(.+)$/.exec(arg)?.[1];
    if (inline !== undefined) hosts.push(inline);
  });
  for (const name of ["PGHOST", "MYSQL_HOST", "DATABASE_URL"]) {
    const value = command.env[name];
    if (value !== undefined) hosts.push(hostOfUrl(value) ?? value);
  }
  return hosts;
};

export const isLocal = (host: string): boolean =>
  host === "" || host.startsWith("/") || LOCAL_HOST.test(host.split(",")[0] ?? "");

const sqlHit = (command: ShellCommand): DestructiveHit | undefined => {
  if (!SQL_CLIENTS.has(command.program)) return undefined;
  const statement = [...command.args, command.stdin ?? ""].join("\n");
  const match = SQL_DESTROY.exec(statement);
  if (match === null) return undefined;
  const remote = sqlHosts(command).find((host) => !isLocal(host));
  return remote === undefined ? undefined : { rule: "sql-destroy", subject: `${match[0].trim()} @ ${remote}` };
};

const subcommand = (args: readonly string[]): string | undefined => args.find((arg) => !arg.startsWith("-"));

const terraformHit = (command: ShellCommand): DestructiveHit | undefined => {
  if (!["terraform", "tofu", "terragrunt"].includes(command.program)) return undefined;
  if (command.args.some((arg) => /^-{1,2}h(?:elp)?$/.test(arg))) return undefined;
  const sub = subcommand(command.args);
  const destroys = sub === "destroy" || (sub === "apply" && command.args.includes("-destroy"));
  return destroys ? { rule: "terraform-destroy", subject: `${command.program} ${sub}` } : undefined;
};

const LOCAL_CONTEXT =
  /^(?:kind-.+|k3d-.+|minikube|docker-desktop|docker-for-desktop|rancher-desktop|orbstack|colima.*)$/;

const flagValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index < 0) return undefined;
  const arg = args[index] ?? "";
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[index + 1];
};

const currentContext = (context: DestructiveContext): string | undefined => {
  const configured = context.env["KUBECONFIG"]?.split(/[:;]/)[0];
  const file = configured !== undefined && configured !== "" ? configured : join(context.home, ".kube", "config");
  const text = context.runtime.readText(toAbsolutePath(file));
  if (!text.ok) return undefined;
  return /^current-context:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(text.value)?.[1];
};

const kubectlHit = (command: ShellCommand, context: DestructiveContext): DestructiveHit | undefined => {
  if (!["kubectl", "oc"].includes(command.program) || subcommand(command.args) !== "delete") return undefined;
  const dryRun = flagValue(command.args, "--dry-run");
  if (dryRun !== undefined && dryRun !== "none") return undefined;
  const target = flagValue(command.args, "--context") ?? currentContext(context) ?? "unknown";
  return LOCAL_CONTEXT.test(target) ? undefined : { rule: "kubectl-delete", subject: target };
};

export const destructiveHit = (command: ShellCommand, context: DestructiveContext): DestructiveHit | undefined =>
  sqlHit(command) ?? terraformHit(command) ?? kubectlHit(command, context);

const BLOCKERS: readonly (readonly [RegExp, string])[] = [
  [/destructive[_-]command[_-]guard|(?:^|[\s/"'])dcg(?:[\s"'.]|$)/m, "dcg"],
  [/cc-safety-net|claude-code-safety-net/, "cc-safety-net"],
];

const SETTINGS = [".claude/settings.json", ".claude/settings.local.json"] as const;

export const externalBlockers = (runtime: Pick<Runtime, "readText">, root: string, home: string): readonly string[] => {
  const texts = [
    ...SETTINGS.map((file) => runtime.readText(toAbsolutePath(join(root, file)))),
    runtime.readText(toAbsolutePath(join(home, ".claude", "settings.json"))),
  ].flatMap((read) => (read.ok ? [read.value] : []));
  return BLOCKERS.filter(([pattern]) => texts.some((text) => pattern.test(text))).map(([, name]) => name);
};
