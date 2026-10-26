import { dirname, relative } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { optionalString } from "../../core/parsed.js";
import { toPosixPath } from "../../core/posix-path.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { toolInput, toolName } from "../../secrets/guards/tool-input.js";
import { STATE_PREFIX } from "../facts.js";
import { recordBaseline, recordEdits, recordShellChanges } from "../ownership.js";
import { openRepo, type Repo } from "../repo.js";
import { ownerOf, SHELL_TOOLS } from "./context.js";

const ALLOW: HookDecision = { kind: "allow" };

const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export const gitSessionStart: HookHandler = (input) => {
  const repo = openRepo(input.runtime, input.cwd);
  if (repo !== undefined) recordBaseline(input.runtime, repo, ownerOf(input.payload));
  return ALLOW;
};

const editedPath = (input: HookInput): { readonly repo: Repo; readonly path: string } | undefined => {
  const inputs = toolInput(input.payload);
  const raw = optionalString(inputs, "file_path") ?? optionalString(inputs, "notebook_path");
  if (raw === undefined || raw === "") return undefined;
  const file = toAbsolutePath(raw, input.cwd);
  const repo = openRepo(input.runtime, toAbsolutePath(dirname(file))) ?? openRepo(input.runtime, input.cwd);
  if (repo === undefined) return undefined;
  const path = toPosixPath(relative(input.runtime.realpath(repo.root), input.runtime.realpath(file)));
  return path === "" || path.startsWith("..") || path.startsWith(STATE_PREFIX) ? undefined : { repo, path };
};

export const gitPostToolUse: HookHandler = (input) => {
  const tool = toolName(input.payload);
  if (EDIT_TOOLS.has(tool)) {
    const edited = editedPath(input);
    if (edited !== undefined) recordEdits(input.runtime, edited.repo, ownerOf(input.payload), [edited.path]);
    return ALLOW;
  }
  if (!SHELL_TOOLS.has(tool)) return ALLOW;
  const repo = openRepo(input.runtime, input.cwd);
  if (repo !== undefined) recordShellChanges(input.runtime, repo, ownerOf(input.payload));
  return ALLOW;
};
