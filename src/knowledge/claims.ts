import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { type Anchor, ANCHOR_MODES } from "./anchor.js";

export const CLAIMS_FILE = "claims.jsonl";
export const CLAIM_SCHEMA = "finitemonkey/claim@1";
export const KNOWLEDGE_CLAIMS_FEATURE = "knowledge-claims";
export const CLAIM_CHECKS_FEATURE = "claim-checks";

export const CLAIM_KINDS = ["prose", "check"] as const;
export const ORIGIN_SOURCES = ["person", "ledger", "agent", "external"] as const;
export const ATTRIBUTIONS = ["person", "agent", "subagent", "tool"] as const;
export const CLAIM_EVENTS = ["add", "stale", "renew", "close", "out", "in", "promote"] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type OriginSource = (typeof ORIGIN_SOURCES)[number];
export type Attribution = (typeof ATTRIBUTIONS)[number];
export type ClaimEventKind = (typeof CLAIM_EVENTS)[number];

export interface DerivedFrom {
  readonly evidence?: string;
  readonly commit?: string;
  readonly prompt?: string;
  readonly session?: string;
}

export interface Origin {
  readonly source: OriginSource;
  readonly attributedTo: Attribution;
  readonly derivedFrom: DerivedFrom;
}

export interface ClaimEvent {
  readonly event: ClaimEventKind;
  readonly id: string;
  readonly recordedAt: string;
  readonly tree?: string;
  readonly commit?: string;
  readonly reason?: string;
  readonly text?: string;
  readonly kind?: ClaimKind;
  readonly run?: string;
  readonly anchors?: readonly Anchor[];
  readonly origin?: Origin;
  readonly because?: readonly string[];
}

export interface Claim {
  readonly id: string;
  readonly text: string;
  readonly kind: ClaimKind;
  readonly run?: string;
  readonly anchors: readonly Anchor[];
  readonly origin: Origin;
  readonly because: readonly string[];
  readonly recordedAt: string;
  readonly validFrom: { readonly tree?: string; readonly commit?: string };
  readonly events: readonly ClaimEvent[];
}

export const claimsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, CLAIMS_FILE));

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find((option) => option === value);

const text = (record: JsonObject, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const anchorOf = (value: unknown): Anchor | undefined => {
  if (!isRecord(value)) return undefined;
  const path = text(value, "path");
  const hash = text(value, "hash");
  const mode = oneOf(ANCHOR_MODES, value["mode"]);
  const symbol = text(value, "symbol");
  if (path === undefined || hash === undefined || mode === undefined) return undefined;
  return { path, mode, hash, ...(symbol === undefined ? {} : { symbol }) };
};

const derivedOf = (value: unknown): DerivedFrom => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    ["evidence", "commit", "prompt", "session"].flatMap((key) => {
      const found = text(value, key);
      return found === undefined ? [] : [[key, found]];
    }),
  );
};

const originOf = (value: unknown): Origin | undefined => {
  if (!isRecord(value)) return undefined;
  const source = oneOf(ORIGIN_SOURCES, value["source"]);
  const attributedTo = oneOf(ATTRIBUTIONS, value["attributedTo"]);
  if (source === undefined || attributedTo === undefined) return undefined;
  return { source, attributedTo, derivedFrom: derivedOf(value["derivedFrom"]) };
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];

const optionalText = (record: JsonObject, keys: readonly string[]): Partial<Record<string, string>> =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const found = text(record, key);
      return found === undefined ? [] : [[key, found]];
    }),
  );

export const parseClaimEvent = (record: JsonObject): ClaimEvent | undefined => {
  const event = oneOf(CLAIM_EVENTS, record["event"]);
  const id = text(record, "id");
  const recordedAt = text(record, "recordedAt");
  if (event === undefined || id === undefined || recordedAt === undefined) return undefined;
  const kind = oneOf(CLAIM_KINDS, record["kind"]);
  const origin = originOf(record["origin"]);
  const anchors = Array.isArray(record["anchors"])
    ? record["anchors"].flatMap((item) => anchorOf(item) ?? [])
    : undefined;
  return {
    event,
    id,
    recordedAt,
    ...optionalText(record, ["tree", "commit", "reason", "text", "run"]),
    ...(kind === undefined ? {} : { kind }),
    ...(origin === undefined ? {} : { origin }),
    ...(anchors === undefined ? {} : { anchors }),
    ...(Array.isArray(record["because"]) ? { because: strings(record["because"]) } : {}),
  };
};

export const readClaimEvents = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ClaimEvent[] => {
  const content = runtime.readText(claimsPath(paths));
  if (!content.ok) return [];
  return content.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const event = parsed?.ok === true ? parseClaimEvent(parsed.value) : undefined;
    return event === undefined ? [] : [event];
  });
};

export const foldClaims = (events: readonly ClaimEvent[]): readonly Claim[] => {
  const claims = new Map<string, Claim>();
  for (const event of events) {
    const current = claims.get(event.id);
    if (event.event === "add") {
      if (current !== undefined || event.text === undefined || event.origin === undefined) continue;
      claims.set(event.id, {
        id: event.id,
        text: event.text,
        kind: event.kind ?? "prose",
        ...(event.run === undefined ? {} : { run: event.run }),
        anchors: event.anchors ?? [],
        origin: event.origin,
        because: event.because ?? [],
        recordedAt: event.recordedAt,
        validFrom: {
          ...(event.tree === undefined ? {} : { tree: event.tree }),
          ...(event.commit === undefined ? {} : { commit: event.commit }),
        },
        events: [event],
      });
      continue;
    }
    if (current === undefined) continue;
    claims.set(event.id, {
      ...current,
      ...(event.event === "renew" && event.anchors !== undefined ? { anchors: event.anchors } : {}),
      events: [...current.events, event],
    });
  }
  return [...claims.values()];
};

export const readClaims = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Claim[] =>
  foldClaims(readClaimEvents(runtime, paths));

export const appendClaimEvent = (
  runtime: Pick<Runtime, "appendText" | "mkdir">,
  paths: FmPaths,
  event: ClaimEvent,
): boolean => {
  runtime.mkdir(paths.dir);
  return runtime.appendText(claimsPath(paths), `${JSON.stringify({ schema: CLAIM_SCHEMA, ...event })}\n`).ok;
};

export const claimId = (text: string, at: string): string => `c-${sha256Hex(`${text}\u0000${at}`).slice(0, 8)}`;

export const lastOf = (claim: Claim, kinds: readonly ClaimEventKind[]): ClaimEvent | undefined =>
  claim.events.findLast((event) => kinds.includes(event.event));
