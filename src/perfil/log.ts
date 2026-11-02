import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { dropEntries, entryId } from "../judge/store.js";
import type { JudgeEntry, ProfileEntry } from "../judge/types.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import {
  clampScore,
  type Domain,
  type DomainProfile,
  DOMAINS,
  parseLevel,
  type Profile,
  startingProfile,
} from "./types.js";

export const PERFIL_GENERATOR = "perfil";

export const profileEntries = (entries: readonly JudgeEntry[]): readonly ProfileEntry[] =>
  entries.filter((entry): entry is ProfileEntry => entry.type === "profile");

const domainOf = (raw: string | undefined): Domain | undefined => DOMAINS.find((domain) => domain === raw);

const quickOf = (raw: string | undefined): Profile["quickStart"] | undefined =>
  raw === "done" || raw === "skipped" || raw === "never" ? raw : undefined;

const snapshotOf = (entry: ProfileEntry): DomainProfile => {
  const claimed = parseLevel(entry.claimed);
  return {
    tool: clampScore(entry.tool ?? 0),
    knowledge: clampScore(entry.knowledge ?? 0),
    ...(claimed === undefined ? {} : { claimed }),
  };
};

const applied = (profile: Profile, entry: ProfileEntry): Profile => {
  const domain = domainOf(entry.domain);
  const quickStart = quickOf(entry.quickStart) ?? profile.quickStart;
  const domains = domain === undefined ? profile.domains : { ...profile.domains, [domain]: snapshotOf(entry) };
  return { domains, quickStart, updatedAt: entry.at };
};

export const profileFromLog = (entries: readonly JudgeEntry[]): Profile | undefined => {
  const own = profileEntries(entries);
  const [first] = own;
  return first === undefined ? undefined : own.reduce(applied, startingProfile(first.at));
};

const sameDomain = (left: DomainProfile, right: DomainProfile): boolean =>
  left.tool === right.tool && left.knowledge === right.knowledge && left.claimed === right.claimed;

const domainRecord = (at: string, domain: Domain, entry: DomainProfile): JsonObject => ({
  type: "profile",
  id: entryId("p", at, domain, String(entry.tool), String(entry.knowledge), entry.claimed ?? ""),
  at,
  domain,
  tool: entry.tool,
  knowledge: entry.knowledge,
  ...(entry.claimed === undefined ? {} : { claimed: entry.claimed }),
});

export const profileRecords = (at: string, logged: Profile | undefined, next: Profile): readonly JsonObject[] => {
  const domains = DOMAINS.filter(
    (domain) => logged === undefined || !sameDomain(logged.domains[domain], next.domains[domain]),
  ).map((domain) => domainRecord(at, domain, next.domains[domain]));
  const quick =
    logged?.quickStart === next.quickStart
      ? []
      : [{ type: "profile", id: entryId("p", at, "quick", next.quickStart), at, quickStart: next.quickStart }];
  return [...domains, ...quick];
};

export const renderProfile = (profile: Profile): string =>
  stringifyYaml({
    schema: "finitemonkey/perfil@1",
    updated_at: profile.updatedAt,
    quick_start: profile.quickStart,
    domains: Object.fromEntries(
      DOMAINS.map((domain) => {
        const entry = profile.domains[domain];
        return [
          domain,
          {
            tool: entry.tool,
            knowledge: entry.knowledge,
            ...(entry.claimed === undefined ? {} : { claimed: entry.claimed }),
          },
        ];
      }),
    ),
  });

export const profileInputs = (entries: readonly JudgeEntry[]): Readonly<Record<string, string>> => ({
  log: sha256Hex(JSON.stringify(profileEntries(entries))).slice(0, 16),
});

export const forgetProfile = (runtime: Pick<Runtime, "readText" | "writeAtomic">, paths: FmPaths): number =>
  dropEntries(runtime, paths, (entry) => entry.type === "profile");
