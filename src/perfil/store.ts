import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";
import type { FmPaths } from "../task/paths.js";
import {
  clampScore,
  type DomainProfile,
  DOMAINS,
  parseLevel,
  type Profile,
  START_SCORE,
  startingProfile,
} from "./types.js";

export const PERFIL_FILE = "perfil.yml";
export const AGENT_COMMITS_FILE = "perfil-commits.json";

export const perfilPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, PERFIL_FILE));
export const agentCommitsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, AGENT_COMMITS_FILE));

const scoreAt = (raw: unknown, key: string): number => {
  const value = isRecord(raw) ? raw[key] : undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? clampScore(parsed) : START_SCORE;
};

const domainFrom = (raw: unknown): DomainProfile => {
  const claimed = parseLevel(isRecord(raw) && typeof raw["claimed"] === "string" ? raw["claimed"] : undefined);
  return {
    tool: scoreAt(raw, "tool"),
    knowledge: scoreAt(raw, "knowledge"),
    ...(claimed === undefined ? {} : { claimed }),
  };
};

export const parseProfile = (text: string, at: string): Profile => {
  const parsed = parseYaml(text);
  if (!parsed.ok || !isRecord(parsed.value)) return startingProfile(at);
  const root = parsed.value;
  const domains = isRecord(root["domains"]) ? root["domains"] : {};
  const quick = root["quick_start"];
  return {
    domains: {
      product: domainFrom(domains["product"]),
      interface: domainFrom(domains["interface"]),
      backend: domainFrom(domains["backend"]),
      infrastructure: domainFrom(domains["infrastructure"]),
      security: domainFrom(domains["security"]),
    },
    quickStart: quick === "done" || quick === "skipped" ? quick : "never",
    updatedAt: typeof root["updated_at"] === "string" ? root["updated_at"] : at,
  };
};

export const readProfile = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths): Profile | undefined => {
  const text = runtime.readText(perfilPath(paths));
  return text.ok ? parseProfile(text.value, runtime.now()) : undefined;
};

export const profileOrStart = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths): Profile =>
  readProfile(runtime, paths) ?? startingProfile(runtime.now());

export const writeProfile = (runtime: Pick<Runtime, "writeText" | "now">, paths: FmPaths, profile: Profile): boolean =>
  runtime.writeText(
    perfilPath(paths),
    stringifyYaml({
      schema: "finitemonkey/perfil@1",
      updated_at: runtime.now(),
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
    }),
  ).ok;

export const updateDomain = (
  profile: Profile,
  domain: keyof Profile["domains"],
  change: (entry: DomainProfile) => DomainProfile,
): Profile => ({ ...profile, domains: { ...profile.domains, [domain]: change(profile.domains[domain]) } });
