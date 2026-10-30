import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { activeGrant } from "../guards/release/grants.js";
import { activeScope, createdFiles, isListed, TESTS_HOLD_GUARD } from "../guards/tests/hold.js";
import { isSnapshot, isTestFile } from "../guards/tests/patterns.js";
import { modelReason } from "../hooks/reason.js";
import type { Translate } from "../i18n/translate.js";
import { MOD_STATE_SCHEMA, type ModRule, type ModState } from "../mod/state.js";
import { featureMode } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { attributionOf } from "./attribution.js";
import { rulesSection } from "./instructions.js";

export const MOD_TIGHTEN_GUARD = "mod-tighten";
export const MOD_BAND_GUARD = "mod-band";
export const MAX_HELD_FILES = 500;

const POLICY_PATH = String.raw`(?:^|/)\.finitemonkey/(?!reports/[^/]+\.json$)`;
const REGISTRY_PATH = String.raw`(?:^|/)\.git/(?:worktrees/[^/]+/)?finitemonkey(?:/|$)`;
const LEAKS_IGNORE = String.raw`(?:^|/)\.gitleaksignore$`;
const SHELL_WRITE_FM = String.raw`(?:>|\btee\b|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\bsed\s+-i)[^;&|]*\.finitemonkey/(?!reports/)`;
const NO_VERIFY = String.raw`(?:^|[\s;&|(])git\b[^;&|]*\s--no-verify\b`;
const HOOKS_PATH = String.raw`core\.hooks[Pp]ath`;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const live = (runtime: Runtime, paths: FmPaths, guard: string): boolean =>
  activeGrant(runtime, paths, guard, nowMs(runtime), undefined) !== undefined;

const selfRules = (t: Translate): readonly ModRule[] => [
  {
    id: "self.policy",
    target: "path",
    pattern: POLICY_PATH,
    reason: modelReason(t, "gate.guard.self.policy", { file: ".finitemonkey/" }),
  },
  {
    id: "self.registry",
    target: "path",
    pattern: REGISTRY_PATH,
    reason: modelReason(t, "gate.guard.self.registry", { file: ".git/finitemonkey/" }),
  },
  {
    id: "self.leaks_ignore",
    target: "path",
    pattern: LEAKS_IGNORE,
    reason: modelReason(t, "gate.guard.self.policy", { file: ".gitleaksignore" }),
  },
  {
    id: "self.shell",
    target: "command",
    pattern: SHELL_WRITE_FM,
    reason: modelReason(t, "gate.guard.self.policy", { file: ".finitemonkey/" }),
  },
];

const bypassRules = (t: Translate): readonly ModRule[] => [
  {
    id: "bypass.no_verify",
    target: "command",
    pattern: NO_VERIFY,
    reason: modelReason(t, "gate.guard.bypass.no_verify", { detail: "--no-verify" }),
  },
  {
    id: "bypass.hooks_path",
    target: "command",
    pattern: HOOKS_PATH,
    reason: modelReason(t, "gate.guard.bypass.hooks_path", { detail: "core.hooksPath" }),
  },
];

const heldTestRules = (runtime: Runtime, paths: FmPaths, t: Translate): readonly ModRule[] => {
  if (featureMode(runtime, paths, TESTS_HOLD_GUARD) !== "active" || live(runtime, paths, "tests")) return [];
  const scope = activeScope(runtime, paths);
  const created = new Set(createdFiles(runtime, paths));
  const tracked = (gitAt(runtime, paths.root).out(["ls-files", "-z"]) ?? "").split("\0");
  return tracked
    .filter((file) => file !== "" && isTestFile(file) && !isSnapshot(file) && !created.has(file))
    .filter((file) => scope === undefined || !isListed(scope, file))
    .slice(0, MAX_HELD_FILES)
    .map((file) => ({
      id: "tests.held",
      target: "path" as const,
      pattern: `^${escape(file)}$`,
      reason: modelReason(t, "gate.guard.tests.held", { file }),
    }));
};

export const modState = (runtime: Runtime, paths: FmPaths, t: Translate): ModState => ({
  schema: MOD_STATE_SCHEMA,
  root: paths.root,
  mode: featureMode(runtime, paths, MOD_TIGHTEN_GUARD),
  band: featureMode(runtime, paths, MOD_BAND_GUARD),
  failReason: t("mod.check_failed"),
  attribution: attributionOf(runtime, paths),
  instructions: rulesSection(runtime, paths),
  rules: [
    ...(live(runtime, paths, "self") ? [] : selfRules(t)),
    ...(live(runtime, paths, "bypass") ? [] : bypassRules(t)),
    ...heldTestRules(runtime, paths, t),
  ],
});
