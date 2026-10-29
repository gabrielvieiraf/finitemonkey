import { type CommandArgs, listOption, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { success } from "../core/result.js";
import { gitAt, headSha, treeHash } from "../gate/git.js";
import { type Anchor, anchorAt, diskReader } from "../knowledge/anchor.js";
import {
  appendClaimEvent,
  type Attribution,
  claimId,
  type DerivedFrom,
  ORIGIN_SOURCES,
  type OriginSource,
  readClaims,
} from "../knowledge/claims.js";
import { instructionLines, recentUntrusted } from "../knowledge/quarantine.js";
import { parsePremise, premiseExists } from "../knowledge/retraction.js";
import { classifyStatement, isRuleLike } from "../rules/classify.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { ADD_USAGE, CLAIMS_SCHEMA, fail } from "./claims-shared.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

const anchorSpec = (spec: string): { readonly path: string; readonly symbol?: string } => {
  const [path = "", symbol] = spec.split("#");
  return { path: path.replace(/^\.\//, ""), ...(symbol === undefined || symbol === "" ? {} : { symbol }) };
};

const sourceOf = (ctx: Ctx, paths: FmPaths, wanted: string | undefined): OriginSource => {
  const asked = ORIGIN_SOURCES.find((item) => item === wanted);
  if (isPerson(ctx)) return asked ?? "person";
  if (asked === "external" || recentUntrusted(ctx.runtime, paths) !== undefined) return "external";
  return asked === "ledger" ? "ledger" : "agent";
};

const attributionOf = (source: OriginSource): Attribution =>
  source === "person" ? "person" : source === "external" ? "tool" : "agent";

const badPremise = (ctx: Ctx, paths: FmPaths, refs: readonly string[]): string | undefined => {
  const claims = readClaims(ctx.runtime, paths);
  return refs.find((ref) => {
    const premise = parsePremise(ref);
    return premise === undefined || !premiseExists(ctx.runtime, paths, claims, premise);
  });
};

const derivedFrom = (values: CommandArgs["values"], commit: string | undefined): DerivedFrom => ({
  ...(commit === undefined ? {} : { commit }),
  ...Object.fromEntries(
    (["session", "evidence", "prompt"] as const).flatMap((key) => {
      const value = stringOption(values, key);
      return value === undefined ? [] : [[key, value]];
    }),
  ),
});

type AnchorSpec = ReturnType<typeof anchorSpec>;

const anchorsFor = (
  read: ReturnType<typeof diskReader>,
  specs: readonly AnchorSpec[],
): { readonly anchors: readonly Anchor[]; readonly missing: AnchorSpec | undefined } => {
  const found = specs.map((spec) => {
    const content = read(spec.path);
    return content === undefined ? undefined : anchorAt(content, spec.path, spec.symbol);
  });
  return {
    anchors: found.flatMap((anchor) => anchor ?? []),
    missing: specs.find((_, index) => found[index] === undefined),
  };
};

export const claimsAddCommand: CommandSpec = {
  path: ["claims", "add"],
  summaryKey: "command.claims_add.summary",
  usage: ADD_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: {
    anchor: { type: "string", multiple: true },
    check: { type: "string" },
    origin: { type: "string" },
    evidence: { type: "string" },
    prompt: { type: "string" },
    session: { type: "string" },
    because: { type: "string", multiple: true },
  },
  run: (ctx, args) => {
    const text = args.positionals[0]?.trim() ?? "";
    const specs = listOption(args.values, "anchor").map(anchorSpec);
    if (text === "" || specs.length === 0) return Promise.resolve(fail(ctx, "knowledge.claims.error.usage", ADD_USAGE));
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const { anchors, missing } = anchorsFor(diskReader(ctx.runtime, root), specs);
      if (missing !== undefined)
        return fail(ctx, "knowledge.claims.error.anchor", ADD_USAGE, {
          anchor: missing.symbol === undefined ? missing.path : `${missing.path}#${missing.symbol}`,
        });
      const premise = badPremise(ctx, paths, listOption(args.values, "because"));
      if (premise !== undefined) return fail(ctx, "knowledge.claims.error.premise", ADD_USAGE, { premise });
      const git = gitAt(ctx.runtime, root);
      const commit = headSha(git);
      const tree = treeHash(git);
      const source = sourceOf(ctx, paths, stringOption(args.values, "origin"));
      if (source === "external" && instructionLines(text).length > 0)
        return fail(ctx, "knowledge.claims.error.instruction", ADD_USAGE);
      const check = stringOption(args.values, "check");
      const recordedAt = ctx.runtime.now();
      const id = claimId(text, recordedAt);
      appendClaimEvent(ctx.runtime, paths, {
        event: "add",
        id,
        recordedAt,
        text,
        kind: check === undefined ? "prose" : "check",
        ...(check === undefined ? {} : { run: check }),
        anchors,
        origin: {
          source,
          attributedTo: attributionOf(source),
          derivedFrom: derivedFrom(args.values, commit),
        },
        because: listOption(args.values, "because"),
        ...(tree === undefined ? {} : { tree }),
        ...(commit === undefined ? {} : { commit }),
      });
      const shaped = check === undefined && isRuleLike(text) && classifyStatement(text).detector !== undefined;
      return success({ schema: CLAIMS_SCHEMA, id, suggestRule: shaped }, [
        ctx.t("knowledge.claims.added", { id }),
        ...(shaped ? [ctx.t("knowledge.claims.suggest_rule")] : []),
      ]);
    });
  },
};
