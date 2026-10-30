import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { LOOK_DIR } from "./paths.js";
import type { Kit, MiniDoc, MiniEl, MiniWin } from "./probe-dom.js";
import { issue, type UxIssue } from "./ux.js";

export const DONT_FILE = "dont.json";
export const DONT_SCHEMA = "finitemonkey/look-dont@1";
export const DONT_OPS = ["equals", "above", "below", "matches"] as const;
export const MAX_HITS_PER_RULE = 5;

export type DontOp = (typeof DONT_OPS)[number];

export interface DontPredicate {
  readonly selector: string;
  readonly property: string;
  readonly op: DontOp;
  readonly value: string;
}

export interface Retired {
  readonly at: string;
  readonly by: string;
  readonly reason: string;
}

export interface DontRule {
  readonly id: string;
  readonly reason: string;
  readonly by: string;
  readonly at: string;
  readonly source: string;
  readonly predicate?: DontPredicate;
  readonly pattern?: string;
  readonly retired?: Retired;
}

export interface DontHit {
  readonly id: string;
  readonly sel: string;
  readonly actual: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const dontPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, LOOK_DIR, DONT_FILE));

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

const predicateOf = (value: unknown): DontPredicate | undefined => {
  if (!isRecord(value)) return undefined;
  const selector = text(value["selector"]);
  const property = text(value["property"]);
  const op = DONT_OPS.find((item) => item === value["op"]);
  const raw = value["value"];
  if (selector === undefined || property === undefined || op === undefined || typeof raw !== "string") return undefined;
  return { selector, property, op, value: raw };
};

const retiredOf = (value: unknown): Retired | undefined => {
  if (!isRecord(value)) return undefined;
  const at = text(value["at"]);
  const by = text(value["by"]);
  const reason = text(value["reason"]);
  return at === undefined || by === undefined || reason === undefined ? undefined : { at, by, reason };
};

const ruleOf = (value: unknown): DontRule | undefined => {
  if (!isRecord(value)) return undefined;
  const id = text(value["id"]);
  const reason = text(value["reason"]);
  const at = text(value["at"]);
  if (id === undefined || reason === undefined || at === undefined) return undefined;
  const predicate = predicateOf(value["predicate"]);
  const pattern = text(value["pattern"]);
  const retired = retiredOf(value["retired"]);
  return {
    id,
    reason,
    at,
    by: text(value["by"]) ?? "",
    source: text(value["source"]) ?? "message",
    ...(predicate === undefined ? {} : { predicate }),
    ...(pattern === undefined ? {} : { pattern }),
    ...(retired === undefined ? {} : { retired }),
  };
};

export const readDont = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly DontRule[] => {
  const raw = runtime.readText(dontPath(paths));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  const list = parsed?.ok === true ? parsed.value["rules"] : undefined;
  return Array.isArray(list) ? list.flatMap((item: unknown) => ruleOf(item) ?? []) : [];
};

export const writeDont = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, rules: readonly DontRule[]): boolean =>
  runtime.writeText(dontPath(paths), `${JSON.stringify({ schema: DONT_SCHEMA, rules }, null, 2)}\n`).ok;

export const nextDontId = (rules: readonly DontRule[]): string =>
  `D${String(Math.max(0, ...rules.map((rule) => Number.parseInt(rule.id.slice(1), 10) || 0)) + 1)}`;

export const liveRules = (rules: readonly DontRule[]): readonly DontRule[] =>
  rules.filter((rule) => rule.retired === undefined);

export const dontHits = (
  kit: Kit,
  doc: MiniDoc,
  win: MiniWin,
  rules: readonly (DontPredicate & { readonly id: string })[],
  cap: number,
): readonly DontHit[] =>
  rules.flatMap((rule) => {
    const found: DontHit[] = [];
    const elements = ((): readonly MiniEl[] => {
      try {
        return [...doc.querySelectorAll(rule.selector)];
      } catch {
        return [];
      }
    })();
    for (const element of elements) {
      if (found.length >= cap) continue;
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      const actual = win.getComputedStyle(element).getPropertyValue(rule.property).trim();
      const number = kit.px(actual);
      const limit = kit.px(rule.value);
      const hit =
        rule.op === "equals"
          ? actual === rule.value
          : rule.op === "above"
            ? number > limit
            : rule.op === "below"
              ? number < limit
              : new RegExp(rule.value).test(actual);
      if (hit)
        found.push({
          id: rule.id,
          sel: kit.selectorOf(element),
          actual,
          x: box.x + win.scrollX,
          y: box.y + win.scrollY,
          w: box.width,
          h: box.height,
        });
    }
    return found;
  });

export const dontIssues = (
  rules: readonly DontRule[],
  hits: readonly DontHit[],
  widest: boolean,
): readonly UxIssue[] => {
  const live = liveRules(rules);
  const byId = new Map(live.map((rule) => [rule.id, rule]));
  const found = hits.flatMap((hit) => {
    const rule = byId.get(hit.id);
    return rule === undefined
      ? []
      : [
          issue("ui/dont", hit.sel, `reintroduces rejection ${rule.id} ("${rule.reason}"): ${hit.actual}`, {
            box: hit,
          }),
        ];
  });
  const textOnly = widest
    ? live
        .filter((rule) => rule.predicate === undefined && rule.pattern === undefined)
        .map((rule) =>
          issue("ui/dont", "body", `rejection ${rule.id} ("${rule.reason}") has no predicate`, { unverified: true }),
        )
    : [];
  return [...found, ...textOnly];
};
