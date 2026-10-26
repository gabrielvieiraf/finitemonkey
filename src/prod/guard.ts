import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { commandText } from "../git/command-text.js";
import { memo, memoBy } from "../git/facts.js";
import { loadProjectConfig } from "../git/project-config.js";
import type { Translate } from "../i18n/translate.js";
import type { ShellCommand } from "../shell/types.js";
import { type IsProdHost, type ProdHit, prodHit } from "./classify.js";
import { hostKey, loadProdTargets, type ProdTargets } from "./targets.js";

export const PROD_PROGRAMS: ReadonlySet<string> = new Set([
  "ssh",
  "scp",
  "rsync",
  "docker",
  "docker-compose",
  "kubectl",
  "helm",
  "psql",
  "mysql",
  "mariadb",
  "mongosh",
  "mongo",
  "redis-cli",
  "pg_dump",
  "mysqldump",
  "pg_restore",
]);

export const EVIDENCE_FILE = ".finitemonkey/prod-evidence.jsonl";

const SSH_LOOKUP_MS = 1500;

export type ProdDecision =
  | { readonly kind: "block"; readonly reason: string }
  | { readonly kind: "read"; readonly hit: ProdHit; readonly command: string };

export interface ProdGuard {
  readonly decide: (command: ShellCommand) => ProdDecision | undefined;
}

const sshHostname = (runtime: Runtime, root: AbsolutePath, destination: string): string | undefined => {
  if (!/^[A-Za-z0-9._@-]+$/.test(destination)) return undefined;
  const result = runtime.exec("ssh", ["-G", destination], root, SSH_LOOKUP_MS);
  if (!result.ok) return undefined;
  const line = result.stdout.split("\n").find((entry) => entry.startsWith("hostname "));
  return line === undefined ? undefined : hostKey(line.slice("hostname ".length));
};

const isProdHostOf = (runtime: Runtime, root: AbsolutePath, targets: () => ProdTargets): IsProdHost =>
  memoBy((raw: string) => {
    const { hosts } = targets();
    if (hosts.size === 0) return false;
    const key = hostKey(raw);
    if (hosts.has(key)) return true;
    const resolved = sshHostname(runtime, root, raw.replace(/^[^@]*@/, ""));
    return resolved !== undefined && hosts.has(resolved);
  });

const blockOf = (t: Translate, hit: ProdHit, command: string, deploy: string | undefined): ProdDecision => ({
  kind: "block",
  reason:
    hit.effect === "interactive"
      ? t("prod.block.interactive", { command, target: hit.target })
      : t("prod.block.effect", { command, target: hit.target, deploy: deploy ?? t("prod.deploy.unknown") }),
});

export const prodGuard = (runtime: Runtime, root: AbsolutePath, t: Translate): ProdGuard => {
  const targets = memo(() => loadProdTargets(runtime, root, loadProjectConfig(runtime, root)));
  const isProd = isProdHostOf(runtime, root, targets);
  return {
    decide: (command) => {
      if (!PROD_PROGRAMS.has(command.program)) return undefined;
      const hit = prodHit(command, targets(), isProd);
      if (hit === undefined) return undefined;
      const text = commandText(command);
      return hit.effect === "read" ? { kind: "read", hit, command: text } : blockOf(t, hit, text, targets().deployPath);
    },
  };
};

export const recordEvidence = (
  runtime: Runtime,
  root: AbsolutePath,
  owner: string,
  reads: readonly ProdDecision[],
): void => {
  const lines = reads.flatMap((read) =>
    read.kind === "read"
      ? [
          JSON.stringify({
            at: runtime.now(),
            owner,
            tool: read.hit.tool,
            target: read.hit.target,
            command: read.command,
          }),
        ]
      : [],
  );
  if (lines.length === 0) return;
  const path = toAbsolutePath(join(root, EVIDENCE_FILE));
  runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey")));
  const before = runtime.readText(path);
  const text = before.ok ? before.value : "";
  runtime.writeAtomic(path, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${lines.join("\n")}\n`);
};
