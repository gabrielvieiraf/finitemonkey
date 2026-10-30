import type { GitFacts } from "../facts.js";
import type { GitInvocation } from "../invocation.js";
import { hasAny, optionSpec, type ParsedOptions, parseOptions, valuesOf } from "../options.js";
import { block, type GitVerdict, PASS } from "../verdict.js";

export const PUSH_OPTIONS = optionSpec(
  [
    "--force",
    "--force-with-lease",
    "--no-force-with-lease",
    "--force-if-includes",
    "--no-force-if-includes",
    "--mirror",
    "--delete",
    "--prune",
    "--all",
    "--branches",
    "--tags",
    "--follow-tags",
    "--set-upstream",
    "--dry-run",
    "--no-dry-run",
    "--porcelain",
    "--verbose",
    "--quiet",
    "--progress",
    "--no-verify",
    "--verify",
    "--atomic",
    "--signed",
    "--push-option",
    "--repo",
    "--receive-pack",
    "--exec",
    "--recurse-submodules",
  ],
  ["--push-option", "--repo", "--receive-pack", "--exec"],
  "o",
);

export type Destinations = "all" | readonly string[];

const branchName = (ref: string): string | undefined => {
  if (ref.startsWith("refs/tags/")) return undefined;
  return ref.replace(/^refs\/heads\//, "");
};

const refspecTarget = (refspec: string, current: string | undefined): string | undefined => {
  const plain = refspec.replace(/^\+/, "");
  const colon = plain.indexOf(":");
  const destination = colon < 0 ? plain : plain.slice(colon + 1);
  if (destination === "HEAD" || (colon < 0 && plain === "HEAD")) return current;
  if (destination === "" || destination.startsWith("refs/tags/")) return undefined;
  return branchName(destination);
};

export const pushDestinations = (parsed: ParsedOptions, facts: GitFacts): Destinations => {
  if (hasAny(parsed, "--all", "--branches", "--mirror")) return "all";
  const refspecs = parsed.positionals.slice(1).filter((refspec) => refspec !== ":");
  const current = facts.currentBranch();
  if (refspecs.length === 0) {
    if (hasAny(parsed, "--tags") || current === undefined) return [];
    return [facts.upstream(current)?.branch ?? current];
  }
  return refspecs.flatMap((refspec) => {
    const target = refspecTarget(refspec, current);
    return target === undefined ? [] : [target];
  });
};

const leaseVerdict = (parsed: ParsedOptions, facts: GitFacts): GitVerdict => {
  const leases = valuesOf(parsed, "--force-with-lease");
  const explicit = leases.length > 0 && leases.every((lease) => /^[^:]+:.+$/.test(lease));
  if (!explicit || !hasAny(parsed, "--force-if-includes")) return block("force-push", "--force-with-lease");
  const current = facts.currentBranch();
  const leased = leases.map((lease) => branchName(lease.slice(0, lease.indexOf(":"))));
  const destinations = pushDestinations(parsed, facts);
  const own =
    current !== undefined &&
    !facts.isProtected(current) &&
    leased.every((name) => name === current) &&
    destinations !== "all" &&
    destinations.every((name) => name === current);
  return own ? PASS : block("lease-not-own", leased.join(", "));
};

const dryRun = (parsed: ParsedOptions): boolean => hasAny(parsed, "--dry-run", "-n") && !hasAny(parsed, "--no-dry-run");

export const isDryRunPush = (args: readonly string[]): boolean => dryRun(parseOptions(args, PUSH_OPTIONS));

export const pushVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  const parsed = parseOptions(invocation.args, PUSH_OPTIONS);
  if (dryRun(parsed)) return PASS;
  if (hasAny(parsed, "--mirror")) return block("push-mirror");
  const refspecs = parsed.positionals.slice(1);
  const deleted = refspecs.find((refspec) => /^\+?:./.test(refspec));
  if (hasAny(parsed, "--delete", "-d", "--prune") || deleted !== undefined) {
    return block("push-delete", deleted?.replace(/^\+?:/, "") ?? refspecs.join(" "));
  }
  const forced = refspecs.find((refspec) => refspec.startsWith("+"));
  if (hasAny(parsed, "--force", "-f") || forced !== undefined) return block("force-push", forced ?? "--force");
  if (hasAny(parsed, "--force-with-lease")) return leaseVerdict(parsed, facts);
  return PASS;
};
