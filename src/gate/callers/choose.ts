import { recordFeatureShadow } from "../../policy/feature.js";
import { guardMode } from "../../quality/gate-sources.js";
import { loadTypescript } from "../../quality/ts-api.js";
import type { GateContext } from "../types.js";
import { languageOf } from "./languages.js";
import { type CallSite, callSites, type RemovedSymbol } from "./scan.js";
import { syntaxCallSites } from "./syntax.js";

export const CALLERS_SYNTAX_FEATURE = "callers-syntax";

const keys = (sites: readonly CallSite[]): ReadonlySet<string> =>
  new Set(sites.map((site) => `${site.name}\0${site.file}\0${String(site.line)}`));

export const chosenSites = (ctx: GateContext, symbols: readonly RemovedSymbol[]): readonly CallSite[] => {
  const byText = callSites(ctx.runtime, ctx.git, symbols);
  if (!symbols.some((symbol) => symbol.language.id === "js")) return byText;
  const mode = guardMode(ctx, CALLERS_SYNTAX_FEATURE);
  const ts = mode === "off" ? undefined : loadTypescript(ctx.paths.root);
  if (ts === undefined) return byText;
  const bySyntax = syntaxCallSites(ctx.runtime, ctx.git, ts, symbols);
  if (mode === "active") return [...byText.filter((site) => languageOf(site.file)?.id !== "js"), ...bySyntax];
  const text = keys(byText.filter((site) => languageOf(site.file)?.id === "js"));
  const syntax = keys(bySyntax);
  recordFeatureShadow(ctx.runtime, ctx.paths, CALLERS_SYNTAX_FEATURE, {
    task: ctx.contract.id,
    text: text.size,
    syntax: syntax.size,
    onlySyntax: [...syntax].filter((key) => !text.has(key)).length,
    onlyText: [...text].filter((key) => !syntax.has(key)).length,
  });
  return byText;
};
