import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { optionalString } from "../../core/parsed.js";
import { toPosixPath } from "../../core/posix-path.js";
import type { Runtime } from "../../core/runtime.js";
import { textField, toolInput, toolName } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { FILE_TOOLS, guardRoot } from "../context.js";
import { claimFile, releaseOwner } from "./locks.js";

export const BACKUPS_DIR = ".finitemonkey/backups";

const ALLOW: HookDecision = { kind: "allow" };

const existingDir = (runtime: Runtime, path: string): AbsolutePath | undefined => {
  let dir = dirname(path);
  while (runtime.stat(toAbsolutePath(dir))?.kind !== "dir") {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return toAbsolutePath(dir);
};

export const isOutsideGit = (runtime: Runtime, path: AbsolutePath): boolean => {
  const dir = existingDir(runtime, path);
  if (dir === undefined) return true;
  if (!runtime.git(["rev-parse", "--is-inside-work-tree"], dir).ok) return true;
  return runtime.git(["check-ignore", "-q", "--", path], dir).ok;
};

const stampOf = (iso: string): string => iso.replace(/[:.]/g, "-");

export const backupPath = (root: AbsolutePath, stamp: string, path: string): AbsolutePath =>
  toAbsolutePath(
    join(
      root,
      BACKUPS_DIR,
      stamp,
      toPosixPath(path)
        .replace(/^[A-Za-z]:/, "")
        .replace(/^\/+/, ""),
    ),
  );

export const ownerOfInput = (input: HookInput): string =>
  optionalString(input.payload.raw, "agent_id") ?? input.payload.sessionId ?? "session";

const backup = (input: HookInput, root: AbsolutePath, path: AbsolutePath): HookDecision | undefined => {
  if (input.runtime.stat(path)?.kind !== "file") return undefined;
  const target = backupPath(root, stampOf(input.runtime.now()), path);
  const copied = input.runtime.copyFile(path, target);
  if (copied.ok) return undefined;
  return {
    kind: "block",
    reason: modelReason(input.t, "git.block.backup_failed", { file: path, detail: copied.error }),
    human: input.t("git.block.human"),
  };
};

export const fileLockGuard: HookHandler = (input) => {
  if (!FILE_TOOLS.has(toolName(input.payload.raw))) return ALLOW;
  const raw = textField(toolInput(input.payload.raw), "file_path", "notebook_path") ?? "";
  if (raw === "") return ALLOW;
  const path = toAbsolutePath(raw, input.cwd);
  if (!isOutsideGit(input.runtime, path)) return ALLOW;
  const root = guardRoot(input);
  const claim = claimFile(input.runtime, root, path, ownerOfInput(input));
  if (claim.kind === "taken") {
    return {
      kind: "block",
      reason: modelReason(input.t, "git.block.file_in_use", { file: path, owner: claim.lock.owner }),
      human: input.t("git.block.human"),
    };
  }
  return backup(input, root, path) ?? ALLOW;
};

export const fileLockRelease: HookHandler = (input) => {
  const agent = optionalString(input.payload.raw, "agent_id");
  const owner = input.event === "SubagentStop" ? agent : (agent ?? input.payload.sessionId);
  if (owner !== undefined) releaseOwner(input.runtime, guardRoot(input), owner);
  return ALLOW;
};
