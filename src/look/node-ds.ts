import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Page } from "playwright-core";

import { DEFAULT_LOOK_FEATURE, defaultLookIssues, DS_FEATURE, dsIssues } from "./ds.js";
import type { PagePass, PassAt } from "./node-ux.js";
import type { Kit, MiniDoc, MiniEl } from "./probe-dom.js";
import { runInPage } from "./probe-dom.js";
import { hasTokens, proposeTokens, type TokenSet } from "./tokens.js";
import { issue } from "./ux.js";

export const excludedIn = (kit: Kit, doc: MiniDoc, selectors: readonly string[]): readonly string[] =>
  selectors.flatMap((selector) => {
    const roots = ((): readonly MiniEl[] => {
      try {
        return [...doc.querySelectorAll(selector)];
      } catch {
        return [];
      }
    })();
    return roots.flatMap((root) => [
      kit.selectorOf(root),
      ...[...root.querySelectorAll("*")].map((child) => kit.selectorOf(child)),
    ]);
  });

const excludedSet = async (page: Page, selectors: readonly string[]): Promise<ReadonlySet<string>> => {
  if (selectors.length === 0) return new Set();
  const raw: unknown = await page.evaluate(runInPage(excludedIn.toString(), ["document", JSON.stringify(selectors)]));
  return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : []);
};

export interface DsOptions {
  readonly tokens: TokenSet;
  readonly exclude: readonly string[];
  readonly proposal: string;
  readonly widest: number;
  readonly tolerance: number;
}

const propose = async (at: PassAt, options: DsOptions) => {
  if (at.viewport !== options.widest) return [];
  const probe = await at.probe();
  if (probe !== undefined) {
    mkdirSync(dirname(options.proposal), { recursive: true });
    writeFileSync(options.proposal, `${JSON.stringify(proposeTokens(probe.nodes), null, 2)}\n`);
  }
  return [
    issue("ds/no-tokens", "html", `no design tokens declared; proposed tokens written to ${options.proposal}`, {
      unverified: true,
    }),
  ];
};

export const dsPass = (options: DsOptions): PagePass => ({
  feature: DS_FEATURE,
  allWidths: false,
  run: async (page, at) => {
    if (!hasTokens(options.tokens)) return propose(at, options);
    const probe = await at.probe();
    if (probe === undefined) return [];
    const found = dsIssues(probe.nodes, options.tokens, await excludedSet(page, options.exclude), options.tolerance);
    at.metric("inside", found.metrics.inside);
    at.metric("outside", found.metrics.outside);
    return found.issues;
  },
});

export const defaultLookPass = (options: DsOptions): PagePass => ({
  feature: DEFAULT_LOOK_FEATURE,
  allWidths: false,
  run: async (page, at) => {
    const probe = await at.probe();
    if (probe === undefined || !hasTokens(options.tokens)) return [];
    return defaultLookIssues(probe.nodes, options.tokens, await excludedSet(page, options.exclude));
  },
});
