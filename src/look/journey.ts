import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import type { FmPaths } from "../task/paths.js";
import { readTrust, writeTrust } from "../task/state.js";
import { uiHash } from "./contract.js";
import { LOOK_DIR } from "./paths.js";
import { type JsonSchema, validate } from "./schema-check.js";
import { issue, type UxPage } from "./ux.js";

export const JOURNEYS_FEATURE = "journeys";
export const JOURNEY_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const target = {
  type: "object",
  additionalProperties: false,
  required: ["role", "name"],
  properties: { role: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 } },
} as const;

const oracle = {
  type: "object",
  additionalProperties: false,
  properties: { text: { type: "string", minLength: 1 }, url: { type: "string", minLength: 1 } },
} as const;

export const JOURNEY_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["says", "steps"],
  properties: {
    says: { type: "string", minLength: 1 },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["expect"],
        properties: {
          goto: { type: "string", minLength: 1 },
          click: target,
          fill: {
            ...target,
            required: ["role", "name", "value"],
            properties: { ...target.properties, value: { type: "string" } },
          },
          expect: oracle,
        },
      },
    },
  },
};

export interface RoleTarget {
  readonly role: string;
  readonly name: string;
}

export interface Oracle {
  readonly text?: string;
  readonly url?: string;
}

export type JourneyAction =
  | { readonly kind: "goto"; readonly route: string }
  | { readonly kind: "click"; readonly target: RoleTarget }
  | { readonly kind: "fill"; readonly target: RoleTarget; readonly value: string }
  | { readonly kind: "none" };

export interface JourneyStep {
  readonly action: JourneyAction;
  readonly expect: Oracle;
}

export interface Journey {
  readonly name: string;
  readonly says: string;
  readonly steps: readonly JourneyStep[];
}

const roleTarget = (value: unknown): RoleTarget | undefined =>
  isRecord(value) && typeof value["role"] === "string" && typeof value["name"] === "string"
    ? { role: value["role"], name: value["name"] }
    : undefined;

const actionOf = (step: Readonly<Record<string, unknown>>): JourneyAction => {
  if (typeof step["goto"] === "string") return { kind: "goto", route: step["goto"] };
  const click = roleTarget(step["click"]);
  if (click !== undefined) return { kind: "click", target: click };
  const fill = step["fill"];
  const filled = roleTarget(fill);
  if (filled !== undefined && isRecord(fill) && typeof fill["value"] === "string")
    return { kind: "fill", target: filled, value: fill["value"] };
  return { kind: "none" };
};

const oracleOf = (value: unknown): Oracle =>
  isRecord(value)
    ? {
        ...(typeof value["text"] === "string" ? { text: value["text"] } : {}),
        ...(typeof value["url"] === "string" ? { url: value["url"] } : {}),
      }
    : {};

export const parseJourney = (name: string, source: string): Parsed<Journey, readonly string[]> => {
  if (!JOURNEY_NAME.test(name)) return reject([`name ${name} must be lowercase letters, digits and dashes`]);
  const yaml = parseYaml(source);
  if (!yaml.ok) return reject([`$: ${yaml.error.message}`]);
  const errors = validate(JOURNEY_SCHEMA, yaml.value);
  if (errors.length > 0) return reject(errors);
  const root = isRecord(yaml.value) ? yaml.value : {};
  const steps = (Array.isArray(root["steps"]) ? root["steps"] : []).flatMap((item: unknown) =>
    isRecord(item) ? [{ action: actionOf(item), expect: oracleOf(item["expect"]) }] : [],
  );
  const empty = steps.findIndex((step) => step.expect.text === undefined && step.expect.url === undefined);
  if (empty >= 0) return reject([`$.steps[${String(empty)}].expect: needs text or url`]);
  return accept({ name, says: typeof root["says"] === "string" ? root["says"] : "", steps });
};

export const journeysDir = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, LOOK_DIR, "journeys"));

export const journeyPath = (paths: FmPaths, name: string): AbsolutePath =>
  toAbsolutePath(join(journeysDir(paths), `${name}.yml`));

export const journeyLockKey = (name: string): string => `journey#${name}`;

export interface JourneyState {
  readonly name: string;
  readonly hash: string;
  readonly approved: boolean;
  readonly journey: Journey | undefined;
  readonly errors: readonly string[];
}

export const journeyState = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  name: string,
): JourneyState | undefined => {
  const source = runtime.readText(journeyPath(paths, name));
  if (!source.ok) return undefined;
  const parsed = parseJourney(name, source.value);
  const locked = readTrust(runtime, paths).approved[journeyLockKey(name)];
  return {
    name,
    hash: uiHash(source.value),
    approved: locked === source.value,
    journey: parsed.ok ? parsed.value : undefined,
    errors: parsed.ok ? [] : parsed.error,
  };
};

export const listJourneys = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  paths: FmPaths,
): readonly JourneyState[] => {
  const names = runtime.listDir(journeysDir(paths));
  return names.ok
    ? names.value
        .filter((file) => file.endsWith(".yml"))
        .map((file) => file.slice(0, -4))
        .sort()
        .flatMap((name) => journeyState(runtime, paths, name) ?? [])
    : [];
};

export const proposeJourney = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  paths: FmPaths,
  name: string,
  source: string,
): Parsed<string, readonly string[]> => {
  const parsed = parseJourney(name, source);
  if (!parsed.ok) return parsed;
  runtime.mkdir(journeysDir(paths));
  const wrote = runtime.writeText(journeyPath(paths, name), source);
  return wrote.ok ? accept(uiHash(source)) : reject([wrote.error]);
};

export const approveJourney = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  name: string,
  hash: string | undefined,
): Parsed<string, "missing" | "invalid" | "hash" | "write"> => {
  const source = runtime.readText(journeyPath(paths, name));
  if (!source.ok) return reject("missing");
  if (!parseJourney(name, source.value).ok) return reject("invalid");
  if (hash !== undefined && hash !== uiHash(source.value)) return reject("hash");
  const lock = readTrust(runtime, paths);
  const saved = writeTrust(runtime, paths, {
    ...lock,
    approved: { ...lock.approved, [journeyLockKey(name)]: source.value },
  });
  return saved.ok ? accept(uiHash(source.value)) : reject("write");
};

export interface JourneyRun {
  readonly passed: boolean;
  readonly failedAt: number | undefined;
  readonly detail: string;
}

export interface JourneyOutcome {
  readonly name: string;
  readonly run: JourneyRun;
  readonly mutants: readonly { readonly step: number; readonly killed: boolean }[];
}

const unapprovedPage = (state: JourneyState): UxPage => ({
  feature: JOURNEYS_FEATURE,
  route: `journey:${state.name}`,
  viewport: 0,
  issues: [
    issue(
      "journey/unapproved",
      state.name,
      state.journey === undefined ? `invalid: ${state.errors.join("; ")}` : "edited since the last approval; not run",
      { unverified: true },
    ),
  ],
});

const outcomePage = (outcome: JourneyOutcome): UxPage => {
  const failed = outcome.run.passed
    ? []
    : [issue("journey/failed", outcome.name, `step ${String((outcome.run.failedAt ?? 0) + 1)}: ${outcome.run.detail}`)];
  const weak = outcome.mutants
    .filter((mutant) => outcome.run.passed && !mutant.killed)
    .map((mutant) =>
      issue(
        "journey/weak",
        `${outcome.name}#${String(mutant.step + 1)}`,
        `skipping step ${String(mutant.step + 1)} does not fail the journey`,
        { advisory: true },
      ),
    );
  return {
    feature: JOURNEYS_FEATURE,
    route: `journey:${outcome.name}`,
    viewport: 0,
    metrics: {
      passed: outcome.run.passed ? 1 : 0,
      mutants: outcome.mutants.length,
      killed: outcome.mutants.filter((mutant) => mutant.killed).length,
    },
    issues: [...failed, ...weak],
  };
};

export const journeyPages = (
  states: readonly JourneyState[],
  outcomes: readonly JourneyOutcome[],
): readonly UxPage[] => [
  ...states.filter((state) => !state.approved || state.journey === undefined).map(unapprovedPage),
  ...outcomes.map(outcomePage),
];
