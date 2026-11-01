import { relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { DECISION_FILE } from "../decide/check.js";
import { deny, guardRoot } from "../guards/context.js";
import { writtenPaths } from "../guards/self/protected.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { PLAN_DIR } from "../plan/folder.js";
import { normalizeCommand } from "../shell/normalize.js";
import type { Redirect, ShellCommand } from "../shell/types.js";
import { POWERSHELL_WRITERS } from "../signals/writes.js";

export const BASH_WRITES_FEATURE = "bash-writes";

const MENTIONED = /(?:^|[^\w.-])(docs\/plan\/\d{2,}-decision-[^\s'"`;|&()<>]+\.md)/;
const HEREDOC = /^<<[-<]?$/;

const allow: HookDecision = { kind: "allow" };

const outputs = (redirects: readonly Redirect[]): readonly string[] =>
  redirects.filter((redirect) => redirect.op !== "<" && !HEREDOC.test(redirect.op)).map((redirect) => redirect.target);

const bashTargets = (command: ShellCommand): readonly string[] =>
  writtenPaths({
    env: command.env,
    argv: command.program === "" ? [] : [command.program, ...command.args],
    redirects: outputs(command.redirects),
  });

const powershellTargets = (command: ShellCommand): readonly string[] => [
  ...outputs(command.redirects),
  ...(POWERSHELL_WRITERS.has(command.program) ? command.args : []),
];

export const shellWriteTargets = (tool: string, command: string): readonly string[] =>
  tool === "PowerShell"
    ? normalizeCommand(command, "powershell").commands.flatMap(powershellTargets)
    : normalizeCommand(command, "bash").commands.flatMap(bashTargets);

const asRecord = (root: AbsolutePath, cwd: AbsolutePath, candidate: string): string | undefined => {
  const posix = toPosixPath(candidate.trim());
  if (posix === "" || /\s/.test(posix)) return undefined;
  const file = toPosixPath(relative(root, toAbsolutePath(posix, cwd)));
  return file.startsWith(`${PLAN_DIR}/`) && DECISION_FILE.test(file.slice(PLAN_DIR.length + 1)) ? file : undefined;
};

export const decisionTarget = (root: AbsolutePath, cwd: AbsolutePath, candidate: string): string | undefined =>
  asRecord(root, cwd, candidate) ?? MENTIONED.exec(toPosixPath(candidate))?.[1];

const commandCwd = (input: Parameters<HookHandler>[0]): AbsolutePath =>
  input.payload.cwd === undefined ? input.cwd : toAbsolutePath(input.payload.cwd, input.cwd);

export const shellDecisionHold: HookHandler = (input) => {
  const raw = input.payload.raw;
  const tool = toolName(raw);
  const command = textField(toolInput(raw), "command");
  if ((tool !== "Bash" && tool !== "PowerShell") || command === undefined) return allow;
  const root = guardRoot(input);
  const cwd = commandCwd(input);
  const file = shellWriteTargets(tool, command)
    .map((candidate) => decisionTarget(root, cwd, candidate))
    .find((target) => target !== undefined);
  if (file === undefined) return allow;
  return deny(modelReason(input.t, "guardian.block.shell", { file }), input.t("guardian.block.shell.human", { file }));
};

export const BASH_WRITES_HANDLERS: HookHandlers = { PreToolUse: [shellDecisionHold] };
