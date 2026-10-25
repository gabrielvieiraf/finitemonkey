import type { AbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Lang } from "../i18n/languages.js";
import type { Translate } from "../i18n/translate.js";
import { type ClaudeInfo, detectClaude } from "./claude-version.js";
import { configTemplate, hasMarker } from "./config-template.js";
import { DENY_RULES } from "./deny-floor.js";
import {
  type Authority,
  chooseRunner,
  detectAuthorities,
  detectLanguages,
  detectPackageManager,
  type PackageManager,
  type SettingsInfo,
  settingsInfo,
} from "./detect.js";
import { withBlock } from "./gitignore-block.js";
import { hashText } from "./hash.js";
import { hookHandler, type HookHandlerJson, INSTALLED_HOOKS, type Runner } from "./hook-entries.js";
import { DEFAULT_STYLE, parseSettings, renderJson, styleOf } from "./json-text.js";
import { CONFIG_FILE, GITIGNORE_FILE, LOCK_FILE, type Preset, SETTINGS_FILE } from "./layout.js";
import { type EntryKind, type LockEntry, type LockFile, parseLock } from "./lock-file.js";
import type { Project } from "./project.js";
import { mergeSettings, type SettingsAdded } from "./settings-merge.js";

export const ACTIONS = ["create", "merge", "update", "unchanged", "keep-edited", "skip-foreign"] as const;

export type Action = (typeof ACTIONS)[number];

export const CHANGING: readonly Action[] = ["create", "merge", "update"];

export interface PlanItem {
  readonly path: string;
  readonly kind: EntryKind;
  readonly action: Action;
  readonly before: string | undefined;
  readonly after: string;
  readonly proposal?: string;
  readonly added?: SettingsAdded;
  readonly handlers?: readonly HookHandlerJson[];
}

export interface Detection {
  readonly root: AbsolutePath;
  readonly gitRoot: boolean;
  readonly packageManager: PackageManager | undefined;
  readonly languages: readonly string[];
  readonly settings: SettingsInfo;
  readonly authorities: readonly Authority[];
  readonly runner: Runner;
  readonly claude: ClaudeInfo;
}

export interface PlanInput {
  readonly preset: Preset;
  readonly lang: Lang;
  readonly bin: string | undefined;
  readonly version: string;
  readonly marketplace: boolean;
  readonly env: Env;
  readonly t: Translate;
}

export interface Plan {
  readonly detection: Detection;
  readonly preset: Preset;
  readonly items: readonly PlanItem[];
  readonly previous: LockFile | undefined;
}

export type PlanError =
  { readonly kind: "settings"; readonly detail: string } | { readonly kind: "lock"; readonly detail: string };

export const detect = (project: Project, gitRoot: boolean, input: PlanInput): Detection => ({
  root: project.root,
  gitRoot,
  packageManager: detectPackageManager(project),
  languages: detectLanguages(project),
  settings: settingsInfo(project.read(SETTINGS_FILE)),
  authorities: detectAuthorities(project, input.env),
  runner: chooseRunner(project, input.bin, input.version),
  claude: detectClaude(project.runtime.probe),
});

export const readPreviousLock = (project: Project): Parsed<LockFile | undefined, PlanError> => {
  const text = project.read(LOCK_FILE);
  if (text === undefined) return accept(undefined);
  const parsed = parseLock(text);
  return parsed.ok ? accept(parsed.value) : reject({ kind: "lock", detail: parsed.error });
};

const actionFor = (before: string | undefined, after: string, existing: Action): Action => {
  if (before === undefined) return "create";
  return before === after ? "unchanged" : existing;
};

const union = (a: readonly string[], b: readonly string[]): readonly string[] => [...new Set([...a, ...b])];

const joinAdded = (previous: SettingsAdded | undefined, next: SettingsAdded): SettingsAdded =>
  previous === undefined
    ? next
    : {
        schema: previous.schema || next.schema,
        attribution: previous.attribution || next.attribution,
        deny: union(previous.deny, next.deny),
        marketplace: previous.marketplace || next.marketplace,
        plugin: previous.plugin || next.plugin,
      };

const wantedHooks = (detection: Detection): Readonly<Record<string, HookHandlerJson>> =>
  Object.fromEntries(
    INSTALLED_HOOKS.map((spec) => [spec.event, hookHandler(detection.runner, spec, detection.claude.failClosed)]),
  );

const settingsItem = (
  project: Project,
  detection: Detection,
  input: PlanInput,
  previous: LockEntry | undefined,
): Parsed<PlanItem, PlanError> => {
  const before = project.read(SETTINGS_FILE);
  const current = parseSettings(before);
  if (!current.ok) return reject({ kind: "settings", detail: current.error });
  const hooks = wantedHooks(detection);
  const wanted = {
    hooks,
    deny: DENY_RULES,
    attributionOff: input.preset === "gabriel",
    marketplace: input.marketplace,
  };
  const merged = mergeSettings(current.value, wanted, previous?.handlers ?? []);
  const after = renderJson(merged.settings, before === undefined ? DEFAULT_STYLE : styleOf(before));
  return accept({
    path: SETTINGS_FILE,
    kind: "settings",
    action: actionFor(before, after, "merge"),
    before,
    after,
    added: joinAdded(previous?.added, merged.added),
    handlers: Object.values(hooks),
  });
};

const gitignoreItem = (project: Project): PlanItem => {
  const before = project.read(GITIGNORE_FILE);
  const after = withBlock(before);
  return { path: GITIGNORE_FILE, kind: "gitignore", action: actionFor(before, after, "merge"), before, after };
};

const configItem = (project: Project, input: PlanInput, previous: LockEntry | undefined): PlanItem => {
  const before = project.read(CONFIG_FILE);
  const template = configTemplate(input.t, input.preset, input.lang);
  const base = { path: CONFIG_FILE, kind: "generated" as const, before };
  if (before === undefined) return { ...base, action: "create", after: template };
  if (previous === undefined && !hasMarker(before)) {
    return { ...base, action: "skip-foreign", after: before, proposal: template };
  }
  if (previous === undefined) {
    return { ...base, action: before === template ? "unchanged" : "keep-edited", after: before, proposal: template };
  }
  if (hashText(before) !== previous.hash) {
    const action = before === template ? "unchanged" : "keep-edited";
    return { ...base, action, after: before, proposal: template };
  }
  return { ...base, action: actionFor(before, template, "update"), after: template };
};

const entryFor = (lock: LockFile | undefined, path: string): LockEntry | undefined =>
  lock?.entries.find((entry) => entry.path === path);

export const buildPlan = (
  project: Project,
  detection: Detection,
  input: PlanInput,
  previous: LockFile | undefined,
): Parsed<Plan, PlanError> => {
  const settings = settingsItem(project, detection, input, entryFor(previous, SETTINGS_FILE));
  if (!settings.ok) return settings;
  const items = [settings.value, gitignoreItem(project), configItem(project, input, entryFor(previous, CONFIG_FILE))];
  return accept({ detection, preset: input.preset, items, previous });
};

export const hasChanges = (plan: Plan): boolean => plan.items.some((item) => CHANGING.includes(item.action));

export const needsWrite = (plan: Plan): boolean => hasChanges(plan) || plan.previous === undefined;
