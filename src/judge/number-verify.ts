import { toAbsolutePath } from "../core/brand.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { citationsIn } from "./cite.js";
import { compareNumber, type FoundNumber, type NumberCheck, type NumberLocale, numbersIn } from "./numbers.js";
import { claimAnchors } from "./probe.js";
import type { ClaimEntry, JudgeAnchor } from "./types.js";
import { CHECK_TIMEOUT_MS, type Verdict, type Verifier, type VerifyContext } from "./verify.js";

export const NUMBER_FEATURE = "number-anchor";
export const DEFAULT_NUMBER_EXCEPTIONS: readonly string[] = ["^(?:19|20)\\d{2}$"];

export interface NumberOptions {
  readonly locale: NumberLocale;
  readonly exceptions: readonly string[];
}

const LINKS = /\[([^\]]*)\]\([^)]*\)|\b10\.\d{4,9}\/\S+|https?:\/\/\S+/g;

export const claimNumbers = (text: string, locale: NumberLocale): readonly FoundNumber[] =>
  numbersIn(text.replace(LINKS, " "), locale);

const excepted = (found: FoundNumber, exceptions: readonly string[]): boolean =>
  found.unit === "plain" && found.magnitude === 1 && exceptions.some((rule) => new RegExp(rule).test(found.raw));

export const inputHash = (context: VerifyContext, input: string): string => {
  const text = context.runtime.readText(toAbsolutePath(input, context.paths.root));
  return text.ok ? sha256Hex(text.value).slice(0, 16) : "missing";
};

interface Pool {
  readonly ref: string;
  readonly numbers: readonly FoundNumber[];
}

const computePool = (anchor: JudgeAnchor, context: VerifyContext, locale: NumberLocale): Pool | "input-changed" => {
  const changed = (anchor.inputs ?? []).some((pair) => {
    const split = pair.lastIndexOf(":");
    return inputHash(context, pair.slice(0, split)) !== pair.slice(split + 1);
  });
  if (changed) return "input-changed";
  const result = context.runtime.exec({
    command: anchor.ref,
    args: [],
    cwd: context.paths.root,
    timeoutMs: CHECK_TIMEOUT_MS,
    shell: true,
    env: { CI: "1" },
  });
  const ok = result.found && !result.timedOut && result.exitCode === 0;
  return { ref: anchor.ref, numbers: ok ? numbersIn(result.stdout, locale) : [] };
};

const sourcePools = (claim: ClaimEntry, context: VerifyContext, locale: NumberLocale): readonly Pool[] =>
  citationsIn(claim.text).flatMap((citation) => {
    const fetched = context.fetcher?.(citation.id);
    return fetched?.status === "ok" ? [{ ref: citation.id, numbers: numbersIn(fetched.content, locale) }] : [];
  });

const stateOf = (found: FoundNumber, pools: readonly Pool[]): NumberCheck => {
  const results = pools.map((pool) => ({ pool, match: compareNumber(found, pool.numbers) }));
  const same = results.find((item) => item.match === "same");
  if (same !== undefined) return { number: found.raw, state: "anchored", anchor: same.pool.ref };
  const wrong = results.find((item) => item.match === "unit" || item.match === "magnitude");
  return wrong === undefined
    ? { number: found.raw, state: "unanchored" }
    : { number: found.raw, state: wrong.match === "unit" ? "unit" : "magnitude", anchor: wrong.pool.ref };
};

const outcomeOf = (checks: readonly NumberCheck[]): string => {
  const counted = checks.filter((check) => check.state !== "exception");
  if (counted.length === 0) return "no-number";
  if (counted.some((check) => check.state === "input-changed")) return "input-changed";
  if (counted.some((check) => check.state === "unit" || check.state === "magnitude")) return "unit-mismatch";
  return counted.every((check) => check.state === "anchored") ? "anchored" : "unanchored";
};

export const checkNumbers = (claim: ClaimEntry, context: VerifyContext, options: NumberOptions): Verdict => {
  const computed = claimAnchors(claim, context.entries)
    .filter((anchor) => anchor.kind === "compute" && anchor.inputs !== undefined)
    .map((anchor) => computePool(anchor, context, options.locale));
  const pools = [
    ...sourcePools(claim, context, options.locale),
    ...computed.filter((item) => item !== "input-changed"),
  ];
  const checks = claimNumbers(claim.text, options.locale).map((found): NumberCheck => {
    if (excepted(found, options.exceptions)) return { number: found.raw, state: "exception" };
    if (computed.includes("input-changed")) return { number: found.raw, state: "input-changed" };
    return stateOf(found, pools);
  });
  const outcome = outcomeOf(checks);
  const anchored = outcome === "anchored";
  const ref = sha256Hex(JSON.stringify(checks)).slice(0, 16);
  return { verified: anchored, outcome, numbers: checks, ...(anchored ? { ref } : {}) };
};

export const numberVerifier =
  (options: NumberOptions): Verifier =>
  (claim, context) =>
    checkNumbers(claim, context, options);
