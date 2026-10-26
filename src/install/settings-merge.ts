import { isRecord, type JsonObject } from "../core/parsed.js";
import { type HookHandlerJson, isOwnHandler } from "./hook-entries.js";
import { asList, asRecord, setKey } from "./json-text.js";

export const SETTINGS_SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json";

export const ATTRIBUTION_OFF = { commit: "", pr: "", sessionUrl: false } as const;

export const MARKETPLACE_ENTRY = { source: { source: "github", repo: "gabrielvieiraf/finitemonkey" } } as const;
export const MARKETPLACE_KEY = "finitemonkey";
export const PLUGIN_ID = "finitemonkey@finitemonkey";

export interface SettingsWanted {
  readonly hooks: Readonly<Record<string, HookHandlerJson>>;
  readonly deny: readonly string[];
  readonly ask: readonly string[];
  readonly attributionOff: boolean;
  readonly marketplace: boolean;
}

export interface SettingsAdded {
  readonly schema: boolean;
  readonly deny: readonly string[];
  readonly ask: readonly string[];
  readonly blockReads: boolean;
  readonly attribution: boolean;
  readonly marketplace: boolean;
  readonly plugin: boolean;
}

const withEntry = (settings: JsonObject, key: string, name: string, value: unknown): JsonObject => {
  const inner = setKey(asRecord(settings[key]), name, value);
  return setKey(settings, key, Object.keys(inner).length === 0 ? undefined : inner);
};

const hasEntry = (settings: JsonObject, key: string, name: string): boolean => name in asRecord(settings[key]);

type IsOwn = (handler: unknown) => boolean;

const replaceInGroup = (group: unknown, isOwn: IsOwn, take: () => unknown): unknown => {
  if (!isRecord(group)) return group;
  const handlers = asList(group["hooks"]).flatMap((handler) => {
    if (!isOwn(handler)) return [handler];
    const replacement = take();
    return replacement === undefined ? [] : [replacement];
  });
  return handlers.length === 0 ? undefined : { ...group, hooks: handlers };
};

const mergeEvent = (groups: readonly unknown[], isOwn: IsOwn, wanted: unknown): readonly unknown[] => {
  let pending = wanted;
  const take = (): unknown => {
    const next = pending;
    pending = undefined;
    return next;
  };
  const kept = groups.map((group) => replaceInGroup(group, isOwn, take)).filter((group) => group !== undefined);
  return pending === undefined ? kept : [...kept, { hooks: [pending] }];
};

const mergeHooks = (hooks: JsonObject, isOwn: IsOwn, wanted: Readonly<Record<string, unknown>>): JsonObject => {
  const events = [...new Set([...Object.keys(hooks), ...Object.keys(wanted)])];
  const entries = events.flatMap((event): [string, unknown][] => {
    const groups = hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) return [[event, groups]];
    const merged = mergeEvent(asList(groups), isOwn, wanted[event]);
    return merged.length === 0 ? [] : [[event, merged]];
  });
  return Object.fromEntries(entries);
};

const withHooks = (settings: JsonObject, hooks: JsonObject): JsonObject => {
  return setKey(settings, "hooks", Object.keys(hooks).length === 0 ? undefined : hooks);
};

const BLOCK_READS = "blockReadsOutsideWorkingDirectories";

interface PermissionLists {
  readonly deny: readonly unknown[];
  readonly ask: readonly unknown[];
  readonly blockReads: unknown;
}

const withPermissions = (settings: JsonObject, lists: PermissionLists): JsonObject => {
  const permissions = asRecord(settings["permissions"]);
  const withDeny = setKey(permissions, "deny", lists.deny.length === 0 ? undefined : lists.deny);
  const withAsk = setKey(withDeny, "ask", lists.ask.length === 0 ? undefined : lists.ask);
  const next = setKey(withAsk, BLOCK_READS, lists.blockReads);
  return setKey(settings, "permissions", Object.keys(next).length === 0 ? undefined : next);
};

const missing = (wanted: readonly string[], existing: readonly unknown[]): readonly string[] =>
  wanted.filter((rule) => !existing.includes(rule));

const withoutAdded = (existing: readonly unknown[], added: readonly string[]): readonly unknown[] =>
  existing.filter((rule) => typeof rule !== "string" || !added.includes(rule));

export const ownHookMatcher =
  (recorded: readonly HookHandlerJson[]) =>
  (handler: unknown): boolean =>
    isOwnHandler(handler) || recorded.some((own) => JSON.stringify(own) === JSON.stringify(handler));

export const mergeSettings = (
  current: JsonObject,
  wanted: SettingsWanted,
  recorded: readonly HookHandlerJson[],
): { readonly settings: JsonObject; readonly added: SettingsAdded } => {
  const schema = Object.keys(current).length === 0;
  const base = schema ? { $schema: SETTINGS_SCHEMA_URL } : current;
  const hooks = mergeHooks(asRecord(base["hooks"]), ownHookMatcher(recorded), wanted.hooks);
  const permissions = asRecord(base["permissions"]);
  const existingDeny = asList(permissions["deny"]);
  const existingAsk = asList(permissions["ask"]);
  const deny = missing(wanted.deny, existingDeny);
  const ask = missing(wanted.ask, existingAsk);
  const blockReads = !(BLOCK_READS in permissions);
  const attribution = wanted.attributionOff && !("attribution" in base);
  const marketplace = wanted.marketplace && !hasEntry(base, "extraKnownMarketplaces", MARKETPLACE_KEY);
  const plugin = wanted.marketplace && !hasEntry(base, "enabledPlugins", PLUGIN_ID);
  let settings = withPermissions(withHooks(base, hooks), {
    deny: [...existingDeny, ...deny],
    ask: [...existingAsk, ...ask],
    blockReads: blockReads ? true : permissions[BLOCK_READS],
  });
  if (attribution) settings = { ...settings, attribution: ATTRIBUTION_OFF };
  if (marketplace) settings = withEntry(settings, "extraKnownMarketplaces", MARKETPLACE_KEY, MARKETPLACE_ENTRY);
  if (plugin) settings = withEntry(settings, "enabledPlugins", PLUGIN_ID, true);
  return { settings, added: { schema, deny, ask, blockReads, attribution, marketplace, plugin } };
};

const sameAttribution = (value: unknown): boolean => JSON.stringify(value) === JSON.stringify(ATTRIBUTION_OFF);

export const unmergeSettings = (
  current: JsonObject,
  added: SettingsAdded,
  recorded: readonly HookHandlerJson[],
): JsonObject => {
  const hooks = mergeHooks(asRecord(current["hooks"]), ownHookMatcher(recorded), {});
  const permissions = asRecord(current["permissions"]);
  let settings = withPermissions(withHooks(current, hooks), {
    deny: withoutAdded(asList(permissions["deny"]), added.deny),
    ask: withoutAdded(asList(permissions["ask"]), added.ask),
    blockReads: added.blockReads && permissions[BLOCK_READS] === true ? undefined : permissions[BLOCK_READS],
  });
  if (added.attribution && sameAttribution(settings["attribution"])) {
    settings = setKey(settings, "attribution", undefined);
  }
  if (added.marketplace) settings = withEntry(settings, "extraKnownMarketplaces", MARKETPLACE_KEY, undefined);
  if (added.plugin) settings = withEntry(settings, "enabledPlugins", PLUGIN_ID, undefined);
  if (added.schema && Object.keys(settings).length === 1 && settings["$schema"] === SETTINGS_SCHEMA_URL) return {};
  return settings;
};

export const ownHandlersIn = (settings: JsonObject): number =>
  Object.values(asRecord(settings["hooks"]))
    .flatMap((groups) => asList(groups))
    .flatMap((group) => asList(asRecord(group)["hooks"]))
    .filter(isOwnHandler).length;
