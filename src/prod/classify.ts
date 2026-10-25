import type { ShellCommand } from "../shell/types.js";
import { dockerReadOnly, kubectlReadOnly, readOnlyRedis, readOnlyScript, readOnlySql } from "./readonly.js";
import { parseCopy, parseSsh, remoteHostOf } from "./remote.js";
import { hostKey, isProdContext, type ProdTargets } from "./targets.js";

export type ProdEffect = "read" | "effect" | "interactive";

export interface ProdHit {
  readonly effect: ProdEffect;
  readonly target: string;
  readonly tool: string;
}

export type IsProdHost = (host: string) => boolean;

const hit = (effect: ProdEffect, target: string, tool: string): ProdHit => ({ effect, target, tool });

const sshHit = (command: ShellCommand, isProd: IsProdHost): ProdHit | undefined => {
  const call = parseSsh(command);
  if (call === undefined || !isProd(call.destination)) return undefined;
  const host = hostKey(call.destination);
  if (call.remote.length === 0) {
    if (command.stdin !== undefined) return hit(readOnlyScript(command.stdin) ? "read" : "effect", host, "ssh");
    return hit(call.noCommand ? "read" : "interactive", host, "ssh");
  }
  return hit(readOnlyScript(call.remote.join(" ")) ? "read" : "effect", host, "ssh");
};

const copyHit = (command: ShellCommand, isProd: IsProdHost): ProdHit | undefined => {
  const call = parseCopy(command);
  const targetHost = call.target === undefined ? undefined : remoteHostOf(call.target);
  if (targetHost !== undefined && isProd(targetHost)) return hit("effect", hostKey(targetHost), command.program);
  const source = call.sources.map(remoteHostOf).find((host) => host !== undefined && isProd(host));
  return source === undefined ? undefined : hit("read", hostKey(source), command.program);
};

const valueAfter = (args: readonly string[], ...names: readonly string[]): string | undefined => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const equals = names.find((name) => arg.startsWith(`${name}=`));
    if (equals !== undefined) return arg.slice(equals.length + 1);
    if (names.includes(arg)) return args[index + 1];
  }
  return undefined;
};

const dockerHit = (command: ShellCommand, targets: ProdTargets, isProd: IsProdHost): ProdHit | undefined => {
  const host = valueAfter(command.args, "-H", "--host") ?? command.env["DOCKER_HOST"];
  const context = valueAfter(command.args, "-c", "--context") ?? command.env["DOCKER_CONTEXT"];
  const remote = host === undefined ? undefined : host.replace(/^(?:ssh|tcp|https?):\/\//, "");
  const switching = command.args[0] === "context" && command.args[1] === "use" ? command.args[2] : undefined;
  if (switching !== undefined && isProdContext(switching, targets.dockerContexts)) return hit("effect", switching, "docker context");
  const prodHost = remote !== undefined && isProd(remote) ? hostKey(remote) : undefined;
  const prodContext = context !== undefined && isProdContext(context, targets.dockerContexts) ? context : undefined;
  const target = prodHost ?? prodContext;
  if (target === undefined) return undefined;
  return hit(dockerReadOnly(command.args) ? "read" : "effect", target, "docker");
};

const kubeHit = (command: ShellCommand, targets: ProdTargets): ProdHit | undefined => {
  const context = valueAfter(command.args, "--context", "--kube-context");
  const [verb, object, name] = command.args.filter((arg) => !arg.startsWith("-"));
  if (verb === "config" && object === "use-context" && name !== undefined && isProdContext(name, targets.kubeContexts)) {
    return hit("effect", name, command.program);
  }
  if (context === undefined || !isProdContext(context, targets.kubeContexts)) return undefined;
  return hit(kubectlReadOnly(command.program, command.args) ? "read" : "effect", context, command.program);
};

const URL_HOST = /^(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?):\/\/(?:[^@/]*@)?([^/:?,]+)/i;
const DATABASE_TOOLS = new Set(["psql", "mysql", "mariadb", "mongosh", "mongo", "redis-cli", "pg_dump", "mysqldump", "pg_restore"]);
const DUMPS = new Set(["pg_dump", "mysqldump"]);

const databaseHost = (command: ShellCommand): string | undefined => {
  const flag = valueAfter(command.args, "-h", "--host");
  if (flag !== undefined) return flag;
  const url = [...command.args, command.env["DATABASE_URL"] ?? ""].map((arg) => URL_HOST.exec(arg)?.[1]).find((host) => host !== undefined);
  return url ?? command.env["PGHOST"];
};

const databaseReadOnly = (command: ShellCommand): boolean => {
  if (DUMPS.has(command.program)) return true;
  if (command.program === "redis-cli") return readOnlyRedis(command.args.filter((arg, index) => !arg.startsWith("-") && !(command.args[index - 1] ?? "").startsWith("-")));
  const sql = valueAfter(command.args, "-c", "--command", "-e", "--execute", "--eval");
  return sql !== undefined && readOnlySql(sql);
};

const databaseHit = (command: ShellCommand, isProd: IsProdHost): ProdHit | undefined => {
  const host = databaseHost(command);
  if (host === undefined || !isProd(host)) return undefined;
  return hit(databaseReadOnly(command) ? "read" : "effect", hostKey(host), command.program);
};

export const prodHit = (command: ShellCommand, targets: ProdTargets, isProd: IsProdHost): ProdHit | undefined => {
  switch (command.program) {
    case "ssh":
      return sshHit(command, isProd);
    case "scp":
    case "rsync":
      return copyHit(command, isProd);
    case "docker":
    case "docker-compose":
      return dockerHit(command, targets, isProd);
    case "kubectl":
    case "helm":
      return kubeHit(command, targets);
    default:
      return DATABASE_TOOLS.has(command.program) ? databaseHit(command, isProd) : undefined;
  }
};
