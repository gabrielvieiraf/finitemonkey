import type { AbsolutePath } from "../core/brand.js";
import type { ExecResult, Runtime } from "../core/runtime.js";
import type { HostEntry } from "./types.js";

export const SSH_TIMEOUT_MS = 20_000;
const SAFE_PATH = /^[\w./~-]+$/;
const SAFE_NAME = /^[\w.-]+$/;
const SAFE_HOST = /^[A-Za-z0-9][\w.:-]*$/;
const SAFE_USER = /^[A-Za-z_][\w.-]*$/;

export type ReadCommand =
  | { readonly kind: "containers" }
  | { readonly kind: "services" }
  | { readonly kind: "revision"; readonly container: string }
  | { readonly kind: "git-status"; readonly path: string }
  | { readonly kind: "git-head"; readonly path: string };

const quote = (value: string, safe: RegExp): string | undefined => (safe.test(value) ? `'${value}'` : undefined);

export const remoteCommand = (command: ReadCommand): string | undefined => {
  switch (command.kind) {
    case "containers":
      return "docker ps --no-trunc --format '{{.Names}} {{.Image}}'";
    case "services":
      return "systemctl list-units --type=service --state=running --no-legend --plain";
    case "revision": {
      const name = quote(command.container, SAFE_NAME);
      return name === undefined
        ? undefined
        : `docker inspect --format '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}' ${name}`;
    }
    case "git-status": {
      const path = quote(command.path, SAFE_PATH);
      return path === undefined ? undefined : `git -C ${path} status --porcelain`;
    }
    case "git-head": {
      const path = quote(command.path, SAFE_PATH);
      return path === undefined ? undefined : `git -C ${path} rev-parse HEAD`;
    }
  }
};

export const destination = (host: HostEntry, user?: string): string => {
  const login = user ?? host.user;
  return login === undefined ? host.host : `${login}@${host.host}`;
};

export const sshRead = (
  runtime: Pick<Runtime, "exec">,
  cwd: AbsolutePath,
  host: HostEntry,
  command: ReadCommand,
  user?: string,
): ExecResult | undefined => {
  const remote = remoteCommand(command);
  const login = user ?? host.user;
  if (remote === undefined || !SAFE_HOST.test(host.host) || (login !== undefined && !SAFE_USER.test(login)))
    return undefined;
  return runtime.exec({
    command: "ssh",
    args: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", destination(host, user), remote],
    cwd,
    timeoutMs: SSH_TIMEOUT_MS,
  });
};
