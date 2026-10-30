import { toAbsolutePath } from "../../core/brand.js";
import { matchesAny } from "../../core/glob.js";
import { catalogMatches, type CopyMatch } from "../../look/copy.js";
import { copyRulesOutcome } from "../../look/copy-gate.js";
import { loadUiConfig, UI_FEATURE } from "../../look/ui.js";
import { featureMode } from "../../policy/feature.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 10;

const projectFiles = (ctx: GateContext): readonly string[] =>
  (ctx.git.out(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]) ?? "")
    .split("\u0000")
    .filter((file) => file !== "");

const matchesIn = (ctx: GateContext, file: string, phrases: readonly string[]): readonly CopyMatch[] => {
  const text = ctx.runtime.readText(toAbsolutePath(file, ctx.paths.root));
  return text.ok ? catalogMatches(file, text.value, phrases) : [];
};

const bannedOutcome = (ctx: GateContext, bannedCopy: readonly string[], catalogs: readonly string[]): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, UI_FEATURE);
  if (bannedCopy.length === 0 || mode === "off") return passed([note("gate.copy.none")]);
  const found = catalogs.flatMap((file) => matchesIn(ctx, file, bannedCopy));
  if (found.length === 0) return passed([note("gate.copy.ok", { count: catalogs.length })]);
  const notes = found
    .slice(0, MAX_LISTED)
    .map((match) => note("gate.copy.found", { file: match.file, key: match.key, phrase: match.phrase }));
  return mode === "active" ? failed(notes) : passed([...notes, note("gate.copy.shadow")]);
};

export const copyCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const ui = loadUiConfig(ctx.runtime, ctx.paths.root);
  const files = projectFiles(ctx);
  const catalogs = files.filter((file) => matchesAny(file, ui.catalogs));
  const banned = bannedOutcome(ctx, ui.bannedCopy, catalogs);
  const rules = copyRulesOutcome(ctx, files, catalogs);
  if (rules.notes.length === 0) return banned;
  const notes = [...banned.notes, ...rules.notes];
  return banned.status === "failed" || rules.blocking ? failed(notes) : passed(notes);
};
