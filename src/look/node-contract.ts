import { isRecord } from "../core/parsed.js";
import { UI_CONTRACT_FEATURE } from "./contract.js";
import { type DontHit, dontHits, dontIssues, type DontRule, liveRules, MAX_HITS_PER_RULE } from "./dont.js";
import { patternHits } from "./ds.js";
import type { PagePass } from "./node-ux.js";
import { runInPage } from "./probe-dom.js";

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const hitOf = (value: unknown): DontHit | undefined =>
  isRecord(value) && typeof value["id"] === "string" && typeof value["sel"] === "string"
    ? {
        id: value["id"],
        sel: value["sel"],
        actual: typeof value["actual"] === "string" ? value["actual"] : "",
        x: num(value["x"]),
        y: num(value["y"]),
        w: num(value["w"]),
        h: num(value["h"]),
      }
    : undefined;

export const contractPass = (rules: readonly DontRule[], widest: number): PagePass => ({
  feature: UI_CONTRACT_FEATURE,
  allWidths: false,
  run: async (page, at) => {
    const predicates = liveRules(rules).flatMap((rule) =>
      rule.predicate === undefined ? [] : [{ ...rule.predicate, id: rule.id }],
    );
    const raw: unknown =
      predicates.length === 0
        ? []
        : await page.evaluate(
            runInPage(dontHits.toString(), [
              "document",
              "window",
              JSON.stringify(predicates),
              String(MAX_HITS_PER_RULE),
            ]),
          );
    const hits = Array.isArray(raw) ? raw.flatMap((item: unknown) => hitOf(item) ?? []) : [];
    const patterned = liveRules(rules).filter((rule) => rule.pattern !== undefined);
    const probe = patterned.length === 0 ? undefined : await at.probe();
    const matched = patternHits(probe?.nodes ?? []).flatMap((hit) =>
      patterned
        .filter((rule) => rule.pattern === hit.pattern)
        .map((rule) => ({
          id: rule.id,
          sel: hit.node.sel,
          actual: hit.detail,
          x: hit.node.x,
          y: hit.node.y,
          w: hit.node.w,
          h: hit.node.h,
        })),
    );
    return dontIssues(rules, [...hits, ...matched], at.viewport === widest);
  },
});
