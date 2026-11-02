import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { projectPaths, sessionCwd } from "../gate/hooks/common.js";
import { editsOf, textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler } from "../hooks/handlers.js";
import { diskReader } from "../knowledge/anchor.js";
import { forgetAgentFile, noteAgentEdits, scanReverts } from "./reverts.js";

const ALLOW: HookDecision = { kind: "allow" };
const PATCH_TOOLS = new Set(["Edit", "MultiEdit"]);
const REWRITE_TOOLS = new Set(["Write", "NotebookEdit"]);

export const agentEditRecorder: HookHandler = (input) => {
  const raw = input.payload.raw;
  const tool = toolName(raw);
  const target = textField(toolInput(raw), "file_path", "notebook_path");
  const paths = projectPaths(input);
  if (paths === undefined || target === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return ALLOW;
  const file = toPosixPath(relative(paths.root, toAbsolutePath(target, sessionCwd(input))));
  if (PATCH_TOOLS.has(tool)) noteAgentEdits(input.runtime, paths, file, editsOf(toolInput(raw)));
  else if (REWRITE_TOOLS.has(tool)) forgetAgentFile(input.runtime, paths, file);
  return ALLOW;
};

export const personRevertScan: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return ALLOW;
  scanReverts(input.runtime, paths, input.t, diskReader(input.runtime, paths.root));
  return ALLOW;
};
