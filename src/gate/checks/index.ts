import type { CheckRegistry } from "../types.js";
import { appsecCheck } from "./appsec.js";
import { callersCheck } from "./callers.js";
import { commandCheck } from "./command.js";
import { copyCheck } from "./copy.js";
import { costCheck } from "./cost.js";
import { decisionCheck } from "./decision.js";
import { deployCheck } from "./deploy.js";
import { diffCheck } from "./diff.js";
import { gitCheck } from "./git.js";
import { inventoryCheck } from "./inventory.js";
import { lookCheck } from "./look.js";
import { manualCheck } from "./manual.js";
import { migrationsCheck } from "./migrations.js";
import { parityCheck } from "./parity.js";
import { placeholdersCheck } from "./placeholders.js";
import { planCheck } from "./plan.js";
import { prOutcome } from "./pr.js";
import { prodCheck } from "./prod.js";
import { proseCheck } from "./prose.js";
import { qualityCheck } from "./quality.js";
import { regressionCheck } from "./regression.js";
import { researchCheck } from "./research.js";
import { reviewCheck } from "./review.js";
import { runtimeCheck } from "./runtime.js";
import { secretsCheck } from "./secrets.js";
import { slopCheck } from "./slop.js";
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
  plan: planCheck,
  decision: decisionCheck,
  research: researchCheck,
  cost: costCheck,
  parity: parityCheck,
  appsec: appsecCheck,
  quality: qualityCheck,
  slop: slopCheck,
  regression: regressionCheck,
  prod: prodCheck,
  copy: copyCheck,
  migrations: migrationsCheck,
  deploy: deployCheck,
};
