import { basename, dirname, join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import type { Runtime } from "../../core/runtime.js";
import { textField, toolInput, toolName } from "../../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import { modelReason } from "../../hooks/reason.js";
import { gitWorktrees } from "../../wt/git-list.js";
import { isWithinPath } from "../../wt/place.js";
import { SHELL_TOOLS } from "../context.js";
import { parseShell, type SimpleCommand } from "../shell.js";

const ALLOW: HookDecision = { kind: "allow" };
const COPIERS = new Set(["cp", "mv", "rsync", "install", "ln", "scp"]);

interface Transfer {
  readonly sources: readonly string[];
  readonly targets: readonly string[];
}

const transferOf = (command: SimpleCommand): Transfer => {
  const [name = "", ...args] = command.argv;
  const operands = args.filter((arg) => !arg.startsWith("-"));
  if (COPIERS.has(name) && operands.length >= 2) {
    return { sources: operands.slice(0, -1), targets: [...operands.slice(-1), ...command.redirects] };
  }
  if (name === "tee") return { sources: [], targets: [...operands, ...command.redirects] };
  return { sources: name === "cat" ? operands : [], targets: command.redirects };
};

interface Trees {
  readonly main: string;
  readonly linked: readonly string[];
}

const insideLinked = (trees: Trees, path: string): boolean => trees.linked.some((tree) => isWithinPath(tree, path));

const intoMain = (trees: Trees, path: string): boolean => isWithinPath(trees.main, path) && !insideLinked(trees, path);

const canonical = (runtime: Runtime, path: string): string => {
  let head = path;
  const tail: string[] = [];
  while (runtime.stat(toAbsolutePath(head)) === undefined) {
    const parent = dirname(head);
    if (parent === head) return path;
    tail.unshift(basename(head));
    head = parent;
  }
  return join(runtime.realpath(head), ...tail);
};

const crossing = (input: HookInput, trees: Trees, transfer: Transfer): string | undefined => {
  const resolve = (path: string): string => canonical(input.runtime, toAbsolutePath(path, input.cwd));
  const fromFront =
    insideLinked(trees, canonical(input.runtime, input.cwd)) ||
    transfer.sources.some((source) => insideLinked(trees, resolve(source)));
  if (!fromFront) return undefined;
  return transfer.targets.find((target) => intoMain(trees, resolve(target)));
};

export const scopeCopyGuard: HookHandler = (input) => {
  const tool = toolName(input.payload.raw);
  if (!SHELL_TOOLS.has(tool)) return ALLOW;
  const transfers = parseShell(textField(toolInput(input.payload.raw), "command") ?? "")
    .map(transferOf)
    .filter((transfer) => transfer.targets.length > 0);
  if (transfers.length === 0) return ALLOW;
  const listed = gitWorktrees(input.runtime, input.cwd);
  const main = listed?.find((tree) => tree.main);
  if (listed === undefined || main === undefined) return ALLOW;
  const real = (path: string): string => canonical(input.runtime, path);
  const trees: Trees = {
    main: real(main.path),
    linked: listed.filter((tree) => !tree.main).map((tree) => real(tree.path)),
  };
  if (trees.linked.length === 0) return ALLOW;
  for (const transfer of transfers) {
    const target = crossing(input, trees, transfer);
    if (target !== undefined) {
      return {
        kind: "block",
        reason: modelReason(input.t, "git.block.scope_copy", { target, main: trees.main }),
        human: input.t("git.block.human"),
      };
    }
  }
  return ALLOW;
};
