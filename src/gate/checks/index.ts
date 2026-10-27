import type { CheckRegistry } from "../types.js";
import { callersCheck } from "./callers.js";
import { commandCheck } from "./command.js";
import { diffCheck } from "./diff.js";
import { gitCheck } from "./git.js";
import { inventoryCheck } from "./inventory.js";
import { lookCheck } from "./look.js";
import { manualCheck } from "./manual.js";
import { placeholdersCheck } from "./placeholders.js";
import { prOutcome } from "./pr.js";
import { proseCheck } from "./prose.js";
import { reviewCheck } from "./review.js";
import { runtimeCheck } from "./runtime.js";
import { secretsCheck } from "./secrets.js";
import { testsCheck } from "./tests.js";
import { mergeCheck, worktreeCheck } from "./worktree.js";

export const DEFAULT_CHECKS: CheckRegistry = {
  command: commandCheck,
  tests: testsCheck,
  diff: diffCheck,
  placeholders: placeholdersCheck,
  git: gitCheck,
  pr: prOutcome,
  manual: manualCheck,
  secrets: secretsCheck,
  prose: proseCheck,
  worktree: worktreeCheck,
  merge: mergeCheck,
  review: reviewCheck,
  callers: callersCheck,
  runtime: runtimeCheck,
  look: lookCheck,
  inventory: inventoryCheck,
};
