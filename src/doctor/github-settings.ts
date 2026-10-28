import { readSettingsCache, type Toggle } from "../ci/protect/state.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { type Check, type CheckFinding, finding } from "./types.js";

const TOGGLES: readonly {
  readonly key: "secretScanning" | "pushProtection" | "dependabotAlerts";
  readonly message: MessageKey;
}[] = [
  { key: "secretScanning", message: "doctor.github.secret_scanning_off" },
  { key: "pushProtection", message: "doctor.github.push_protection_off" },
  { key: "dependabotAlerts", message: "doctor.github.dependabot_alerts_off" },
];

const off = (value: Toggle): boolean => value === "disabled";

export const checkGithubSettings: Check = (env) => {
  const settings = readSettingsCache(env.runtime, env.root);
  if (settings === undefined) return [];
  const missing: CheckFinding[] = TOGGLES.filter((item) => off(settings[item.key])).map((item) =>
    finding("github-settings", "warn", item.message, { repo: settings.repo }, "doctor.github.fix_protect"),
  );
  if (settings.ruleset === null)
    missing.push(
      finding(
        "github-settings",
        "warn",
        "doctor.github.no_protect_ruleset",
        { repo: settings.repo },
        "doctor.github.fix_protect",
      ),
    );
  return missing.length > 0
    ? missing
    : [finding("github-settings", "ok", "doctor.github.settings_ok", { repo: settings.repo })];
};
