import { join, relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { toPosixPath } from "../../core/posix-path.js";
import { ownerOf } from "../../git/hooks/context.js";
import { applyEdits, editsOf, textField, toolInput, toolName } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { fmPaths } from "../../task/paths.js";
import { readTrust } from "../../task/state.js";
import { deny, FILE_TOOLS, grantFor, guardRoot, SHELL_TOOLS } from "../context.js";
import { writtenPaths } from "../self/protected.js";
import { parseShell } from "../shell.js";
import { compareConfig, compareNewTestFile, compareTestFile, type TestViolation } from "./analyze.js";
import { isProtectedConfig, isTestFile } from "./patterns.js";
import { restoreOf, type RestoreSpec } from "./restore.js";
import {
  createdBySession,
  restoresStart,
  type SessionFile,
  sessionFile,
  sourceBlob,
  textBlob,
} from "./session-start.js";

const localPath = (root: AbsolutePath, path: string): string => toPosixPath(relative(root, toAbsolutePath(path, root)));

const read = (input: HookInput, path: AbsolutePath): string | undefined => {
  const text = input.runtime.readText(path);
  return text.ok ? text.value : undefined;
};

const ownFile = (input: HookInput, root: AbsolutePath, local: string): SessionFile | undefined =>
  sessionFile(input.runtime, root, ownerOf(input.payload), toAbsolutePath(join(root, local)));

const proposed = (tool: string, args: ReturnType<typeof toolInput>, before: string | undefined): string | undefined => {
  if (tool === "Write") return textField(args, "content") ?? "";
  return before === undefined ? undefined : applyEdits(before, editsOf(args));
};

const fileViolations = (input: HookInput, root: AbsolutePath): readonly TestViolation[] => {
  const tool = toolName(input.payload.raw);
  const args = toolInput(input.payload.raw);
  const file = textField(args, "file_path") ?? "";
  if (tool === "NotebookEdit" || file === "") return [];
  const local = localPath(root, file);
  if (!isTestFile(local) && !isProtectedConfig(local)) return [];
  const before = read(input, toAbsolutePath(file, root));
  const after = proposed(tool, args, before);
  if (after === undefined) return [];
  const accepted = readTrust(input.runtime, fmPaths(root)).configs[local];
  if (before === undefined) return compareNewTestFile(local, after);
  const own = isTestFile(local) ? ownFile(input, root, local) : undefined;
  if (own !== undefined && restoresStart(own, textBlob(own, after))) return [];
  if (own !== undefined && createdBySession(own)) return compareNewTestFile(local, after);
  return [...compareTestFile(local, before, after), ...compareConfig(local, before, after, accepted)];
};

const restored = (own: SessionFile, restore: RestoreSpec | undefined, root: AbsolutePath, path: string): boolean =>
  restore !== undefined &&
  restore.paths.some((item) => localPath(root, item) === localPath(root, path)) &&
  restoresStart(own, sourceBlob(own, restore.source));

const isTree =
  (input: HookInput, root: AbsolutePath) =>
  (rev: string): boolean =>
    input.runtime.git(["rev-parse", "--verify", "--quiet", `${rev}^{tree}`], root).ok;

const shellViolations = (input: HookInput, root: AbsolutePath): readonly TestViolation[] => {
  const command = textField(toolInput(input.payload.raw), "command") ?? "";
  return parseShell(command).flatMap((simple) => {
    const restore = restoreOf(simple, isTree(input, root));
    return writtenPaths(simple).flatMap((path): readonly TestViolation[] => {
      const local = localPath(root, path);
      const exists = input.runtime.stat(toAbsolutePath(join(root, local))) !== undefined;
      if (!exists) return [];
      if (isProtectedConfig(local)) return [{ kind: "config_changed", path: local }];
      if (!isTestFile(local)) return [];
      const own = ownFile(input, root, local);
      if (own !== undefined && (createdBySession(own) || restored(own, restore, root, path))) return [];
      return [{ kind: "test_removed", path: local }];
    });
  });
};

export const testsGuard: HookHandler = (input): HookDecision => {
  const tool = toolName(input.payload.raw);
  const root = guardRoot(input);
  const found = FILE_TOOLS.has(tool)
    ? fileViolations(input, root)
    : SHELL_TOOLS.has(tool)
      ? shellViolations(input, root)
      : [];
  const first = found[0];
  if (first === undefined || grantFor(input, "tests") !== undefined) return { kind: "allow" };
  const { t } = input;
  const params = { file: first.path, before: first.before ?? 0, after: first.after ?? 0 };
  const reason = SHELL_TOOLS.has(tool) ? t("gate.guard.tests.shell", params) : t(`gate.tests.${first.kind}`, params);
  return deny(modelReason(t, "gate.guard.tests", { detail: reason }), t("gate.guard.tests.human", { detail: reason }));
};
