import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { type Markers, withManagedBlock, withoutManagedBlock } from "../install/managed-block.js";
import type { AcceptanceCheck } from "../task/types.js";
import { type Purpose, PURPOSES } from "./purpose.js";
import type { Ran } from "./run.js";

export const ONBOARD_FILE = ".finitemonkey/onboard.json";
export const ONBOARD_SCHEMA = "finitemonkey/onboard@1";
export const ONBOARD_FEATURE = "onboard";
export const ONBOARD_MARKERS: Markers = {
  begin: "<!-- finitemonkey:onboard:begin -->",
  end: "<!-- finitemonkey:onboard:end -->",
};

export interface OnboardCommand {
  readonly purpose: Purpose;
  readonly run: string;
}

export interface OnboardState {
  readonly commands: readonly OnboardCommand[];
  readonly historyFindings: number | undefined;
}

const purposeOf = (value: unknown): Purpose | undefined => PURPOSES.find((item) => item === value);

export const parseOnboard = (text: string | undefined): OnboardState | undefined => {
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  if (parsed?.ok !== true || parsed.value["schema"] !== ONBOARD_SCHEMA) return undefined;
  const list = parsed.value["commands"];
  const commands = (Array.isArray(list) ? list : []).flatMap((item: unknown): OnboardCommand[] => {
    if (!isRecord(item) || typeof item["run"] !== "string") return [];
    const purpose = purposeOf(item["purpose"]);
    return purpose === undefined ? [] : [{ purpose, run: item["run"] }];
  });
  const history = parsed.value["historyFindings"];
  return { commands, historyFindings: typeof history === "number" ? history : undefined };
};

export const onboardText = (state: OnboardState): string =>
  `${JSON.stringify(
    {
      schema: ONBOARD_SCHEMA,
      commands: state.commands.map((item) => ({ purpose: item.purpose, run: item.run })),
      ...(state.historyFindings === undefined ? {} : { historyFindings: state.historyFindings }),
    },
    null,
    2,
  )}\n`;

export const passedCommands = (ran: readonly Ran[]): readonly OnboardCommand[] =>
  ran.filter((item) => item.outcome === "passed").map((item) => ({ purpose: item.purpose, run: item.run }));

export const onboardChecks = (state: OnboardState): readonly AcceptanceCheck[] =>
  state.commands.map((item, index) => ({
    id: item.purpose === "test" ? (index === 0 ? "test" : `test-${String(index)}`) : `${item.purpose}-${String(index)}`,
    kind: item.purpose === "test" ? "tests" : "command",
    run: item.run,
  }));

export const agentsBlock = (
  heading: string,
  header: string,
  commands: readonly OnboardCommand[],
): readonly string[] => [
  `## ${heading}`,
  "",
  header,
  "| --- | --- |",
  ...commands.map((item) => `| ${item.purpose} | \`${item.run.replace(/\|/g, "\\|")}\` |`),
];

export const withOnboardBlock = (text: string | undefined, body: readonly string[]): string =>
  withManagedBlock(text, ONBOARD_MARKERS, body);

export const outsideOnboardBlock = (text: string): string => withoutManagedBlock(text, ONBOARD_MARKERS);

export const writeIfChanged = (runtime: Runtime, root: AbsolutePath, file: string, text: string): boolean => {
  const path = toAbsolutePath(join(root, file));
  const current = runtime.readText(path);
  if (current.ok && current.value === text) return false;
  return runtime.writeText(path, text).ok;
};
