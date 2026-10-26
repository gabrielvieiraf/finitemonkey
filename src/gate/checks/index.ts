import type { CheckRegistry } from "../types.js";
import { commandCheck } from "./command.js";
import { diffCheck } from "./diff.js";
import { gitCheck } from "./git.js";
import { manualCheck } from "./manual.js";
import { placeholdersCheck } from "./placeholders.js";
import { prOutcome } from "./pr.js";
import { secretsCheck } from "./secrets.js";
import { testsCheck } from "./tests.js";

export const DEFAULT_CHECKS: CheckRegistry = {
  command: commandCheck,
  tests: testsCheck,
  diff: diffCheck,
  placeholders: placeholdersCheck,
  git: gitCheck,
  pr: prOutcome,
  manual: manualCheck,
  secrets: secretsCheck,
};
