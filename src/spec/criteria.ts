import type { AcceptanceCheck } from "../task/types.js";
import type { SpecItem } from "./parse.js";

export interface SpecCriterion {
  readonly id: string;
  readonly from: string;
  readonly text: string;
  readonly ears: boolean;
  readonly checkable: boolean;
  readonly check: AcceptanceCheck;
}

const COMMAND =
  /`((?:npm|pnpm|yarn|npx|bun|bunx|deno|node|pytest|python3?|go|cargo|make|mvn|gradle|dotnet|php|bundle|rake|\.\/)\b[^`]*)`/;
const GET = /\bGET\b/;
const ROUTE = /\s(\/[A-Za-z0-9_\-/{}:.]*)/;
const STATUS = /\b([1-5]\d\d)\b/;

const commandCheck = (id: string, item: SpecItem): AcceptanceCheck | undefined => {
  const run = COMMAND.exec(item.text)?.[1];
  return run === undefined ? undefined : { id, kind: "command", run: run.trim(), description: item.text };
};

const runtimeCheck = (id: string, item: SpecItem, port: number | undefined): AcceptanceCheck | undefined => {
  const route = ROUTE.exec(item.text)?.[1];
  const status = STATUS.exec(item.text.replace(ROUTE, " "))?.[1];
  if (!item.ears || !GET.test(item.text) || route === undefined || status === undefined || port === undefined)
    return undefined;
  return { id, kind: "runtime", port, route, status: Number(status), description: item.text };
};

export const criteriaOf = (items: readonly SpecItem[], port: number | undefined): readonly SpecCriterion[] =>
  items.map((item, index) => {
    const id = `S${String(index + 1)}`;
    const check = commandCheck(id, item) ?? runtimeCheck(id, item, port);
    return {
      id,
      from: item.from,
      text: item.text,
      ears: item.ears,
      checkable: check !== undefined,
      check: check ?? { id, kind: "manual", description: item.text },
    };
  });
