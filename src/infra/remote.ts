import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { sshRead } from "./ssh.js";
import type { HostEntry } from "./types.js";

const DETAIL = 160;

const count = (stdout: string): number => stdout.split(/\r?\n/).filter((line) => line.trim() !== "").length;

const hostLine = (ctx: Pick<Ctx, "runtime" | "t">, root: AbsolutePath, host: HostEntry): string => {
  const containers = sshRead(ctx.runtime, root, host, { kind: "containers" });
  if (containers === undefined) return ctx.t("infra.remote.unsafe", { alias: host.alias });
  if (!containers.found || containers.exitCode !== 0) {
    const detail = (containers.stderr.trim() || `exit ${String(containers.exitCode)}`).slice(0, DETAIL);
    return ctx.t("infra.remote.failed", { alias: host.alias, detail });
  }
  const services = sshRead(ctx.runtime, root, host, { kind: "services" });
  return ctx.t("infra.remote.host", {
    alias: host.alias,
    containers: count(containers.stdout),
    services: services?.exitCode === 0 ? count(services.stdout) : 0,
  });
};

export const remoteLines = (
  ctx: Pick<Ctx, "runtime" | "t">,
  root: AbsolutePath,
  hosts: readonly HostEntry[],
): readonly string[] =>
  hosts.length === 0 ? [ctx.t("infra.remote.no_hosts")] : hosts.map((host) => hostLine(ctx, root, host));
