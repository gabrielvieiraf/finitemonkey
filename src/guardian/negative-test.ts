import type { TaskContract } from "../task/types.js";
import type { Assumption } from "./assumptions.js";

export interface NegativeTest {
  readonly assumption: string;
  readonly premise: string;
  readonly criterion: string;
  readonly run: string;
  readonly file: string | null;
  readonly skeleton: string;
}

const BEHAVIOR = /^behaviou?r\b/i;
const SLUG_MAX = 40;

export const isBehaviorPremise = (item: Pick<Assumption, "verify">): boolean => BEHAVIOR.test(item.verify.trim());

const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "") || "premise";

const quoted = (text: string): string => JSON.stringify(text);

const pythonTest = (slug: string, criterion: string, premise: string): string =>
  [
    `def test_${slug.replace(/-/g, "_")}_fails_when_premise_breaks():`,
    `    raise AssertionError(${quoted(`${criterion}: write the case where this premise is false and expect the criterion to fail: ${premise}`)})`,
    "",
  ].join("\n");

const importIt = (module: string): string => ["import { it } from", `${quoted(module)};`].join(" ");

const jsHeader = (run: string): readonly string[] => {
  if (/\bvitest\b/.test(run)) return [importIt("vitest"), ""];
  if (/\bjest\b/.test(run)) return [];
  return [importIt("node:test"), ""];
};

const jsTest = (run: string, criterion: string, premise: string): string =>
  [
    ...jsHeader(run),
    `it(${quoted(`${criterion}: fails when the premise does not hold: ${premise}`)}, () => {`,
    `  throw new Error(${quoted("write the case where this premise is false, then assert that the criterion fails")});`,
    "});",
    "",
  ].join("\n");

const shape = (run: string, slug: string, criterion: string, premise: string) => {
  if (/\b(pytest|python3?)\b/.test(run))
    return {
      file: `tests/test_${slug.replace(/-/g, "_")}_negative.py`,
      skeleton: pythonTest(slug, criterion, premise),
    };
  if (/\b(npm|pnpm|yarn|npx|node|vitest|jest|bun)\b/.test(run))
    return { file: `test/${slug}.negative.test.ts`, skeleton: jsTest(run, criterion, premise) };
  return { file: null, skeleton: `${criterion}: ${premise} -> ${run}` };
};

export const negativeTestFor = (item: Assumption, contract: TaskContract | undefined): NegativeTest | undefined => {
  if (!isBehaviorPremise(item)) return undefined;
  const check = contract?.acceptance.find((entry) => entry.run !== undefined && entry.run.trim() !== "");
  const criterion = check?.id ?? contract?.acceptance[0]?.id ?? "-";
  const run = check?.run?.trim() ?? "";
  return {
    assumption: item.id,
    premise: item.text,
    criterion,
    run,
    ...shape(run, slugOf(item.text), criterion, item.text),
  };
};
