import type { JsonObject } from "../core/parsed.js";
import { asList, asRecord, setKey } from "../install/json-text.js";
import { type Markers, withManagedBlock, withoutManagedBlock } from "../install/managed-block.js";
import type { Manifest } from "./manifest.js";
import type { ProjectRule } from "./types.js";

export const AGENTS_MARKERS: Markers = {
  begin: "<!-- finitemonkey:rules begin -->",
  end: "<!-- finitemonkey:rules end -->",
};
export const WORKFLOW_FILE = ".github/workflows/finitemonkey-rules.yml";
export const CI_JOB = "finitemonkey rules";
export const PRESENCE_MARK = "finitemonkey:rules-presence";
export const PRESENCE_COMMAND = `sh -c 'command -v finitemonkey >/dev/null 2>&1 || test -f .finitemonkey/runtime/dist/finitemonkey.mjs || echo "Finite Monkey is not active in this session: its executable is missing, so the project rules in .finitemonkey/rules.yml are not enforced here." # ${PRESENCE_MARK}'`;

export const ruleLine = (rule: Pick<ProjectRule, "id" | "text">): string => `- ${rule.text} (rule ${rule.id})`;

export const withRulesBlock = (text: string | undefined, rules: readonly ProjectRule[]): string =>
  withManagedBlock(text, AGENTS_MARKERS, rules.map(ruleLine));

export const withoutRulesBlock = (text: string): string => withoutManagedBlock(text, AGENTS_MARKERS);

const isPresence = (group: unknown): boolean =>
  asList(asRecord(group)["hooks"]).some((handler) => String(asRecord(handler)["command"]).includes(PRESENCE_MARK));

const withPresence = (settings: JsonObject, wanted: boolean): JsonObject => {
  const hooks = asRecord(settings["hooks"]);
  const others = asList(hooks["SessionStart"]).filter((group) => !isPresence(group));
  const groups = wanted ? [...others, { hooks: [{ type: "command", command: PRESENCE_COMMAND, timeout: 5 }] }] : others;
  const nextHooks = setKey(hooks, "SessionStart", groups.length === 0 ? undefined : groups);
  return setKey(settings, "hooks", Object.keys(nextHooks).length === 0 ? undefined : nextHooks);
};

const withDeny = (settings: JsonObject, add: readonly string[], remove: readonly string[]): JsonObject => {
  const permissions = asRecord(settings["permissions"]);
  const current = asList(permissions["deny"]).filter((item) => !remove.includes(String(item)));
  const deny = [...current, ...add.filter((item) => !current.includes(item))];
  const nextPermissions = setKey(permissions, "deny", deny.length === 0 ? undefined : deny);
  return setKey(settings, "permissions", Object.keys(nextPermissions).length === 0 ? undefined : nextPermissions);
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const withoutCompiledSettings = (settings: JsonObject, manifest: Manifest): JsonObject => {
  const compiled = Object.values(manifest.rules);
  const deny = compiled.flatMap((rule) => rule.deny);
  const keyed = compiled.flatMap((rule) => Object.entries(rule.settings));
  const cleaned = keyed.reduce<JsonObject>(
    (current, [key, value]) => (sameJson(current[key], value) ? setKey(current, key, undefined) : current),
    withDeny(settings, [], deny),
  );
  return withPresence(cleaned, false);
};

export const withCompiledSettings = (settings: JsonObject, previous: Manifest, next: Manifest): JsonObject => {
  const base = withoutCompiledSettings(settings, previous);
  const compiled = Object.values(next.rules);
  const withKeys = compiled
    .flatMap((rule) => Object.entries(rule.settings))
    .reduce<JsonObject>((current, [key, value]) => setKey(current, key, value), base);
  return withPresence(
    withDeny(
      withKeys,
      compiled.flatMap((rule) => rule.deny),
      [],
    ),
    next.presenceHook,
  );
};

export const workflowText = (rules: readonly ProjectRule[], version: string): string =>
  [
    "# finitemonkey:generated rules; written by finitemonkey rules compile --ci, removed by uninstall",
    `name: ${CI_JOB}`,
    "on:",
    "  pull_request:",
    "permissions:",
    "  contents: read",
    "  pull-requests: read",
    "jobs:",
    "  rules:",
    `    name: ${CI_JOB}`,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    ...rules.map((rule) => `      # finitemonkey:rule ${rule.id}`),
    `      - run: npx --yes finitemonkey@${version} rules check --ci`,
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    "",
  ].join("\n");

export const workflowRuleIds = (text: string): ReadonlySet<string> =>
  new Set([...text.matchAll(/^\s*# finitemonkey:rule ([a-z0-9-]+)$/gm)].map((match) => match[1] ?? ""));
