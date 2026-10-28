import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import type { HookInput } from "../../hooks/handlers.js";
import { loadLookConfig } from "../../look/config.js";
import { loadTask } from "../../task/load.js";
import type { FmPaths } from "../../task/paths.js";
import { readState } from "../../task/state.js";
import type { TaskContract } from "../../task/types.js";
import { gitAt } from "../git.js";
import { readGateStatus } from "./status.js";

export const ROUTINE_MAX_BYTES = 1500;
const MAX_GOAL = 200;
const LONG_SIZES = new Set(["M", "L"]);

const quote = (text: string): string => (/\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text);

const startCommand = (input: HookInput, paths: FmPaths, contract: TaskContract): string | undefined =>
  contract.acceptance.find((check) => check.kind === "runtime" && check.run !== undefined)?.run ??
  loadLookConfig(input.runtime, paths.root)?.start;

const endToEnd = (contract: TaskContract): string | undefined => {
  const runtime = contract.acceptance.find((check) => check.kind === "runtime" && check.port !== undefined);
  if (runtime?.port !== undefined) {
    const start = runtime.run === undefined ? "" : ` --start ${quote(runtime.run)}`;
    return `finitemonkey app check --port ${String(runtime.port)}${start} --route ${runtime.route ?? "/"}`;
  }
  const command = contract.acceptance.find(
    (check) => (check.kind === "command" || check.kind === "tests") && check.run !== undefined,
  );
  return command?.run;
};

const loadActive = (input: HookInput, paths: FmPaths): TaskContract | undefined => {
  const active = readState(input.runtime, paths).active;
  if (active === undefined) return undefined;
  const disk = (relative: string): string | undefined => {
    const text = input.runtime.readText(toAbsolutePath(join(paths.root, relative)));
    return text.ok ? text.value : undefined;
  };
  const loaded = loadTask(input.runtime, paths, { disk, base: () => undefined }, active);
  return loaded.ok && LONG_SIZES.has(loaded.value.contract.size) ? loaded.value.contract : undefined;
};

const capBytes = (text: string, max: number): string => {
  if (Buffer.byteLength(text, "utf8") <= max) return text;
  let cut = text.slice(0, max);
  while (Buffer.byteLength(cut, "utf8") > max - 1) cut = cut.slice(0, -1);
  return `${cut}…`;
};

export const startupRoutine = (input: HookInput, paths: FmPaths): string | undefined => {
  const contract = loadActive(input, paths);
  if (contract === undefined) return undefined;
  const { t } = input;
  const status = readGateStatus(input.runtime, paths);
  const commits = (gitAt(input.runtime, paths.root).out(["log", "--oneline", "-3"]) ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const start = startCommand(input, paths, contract);
  const check = endToEnd(contract);
  const lines = [
    t("routine.header", { task: contract.id, size: contract.size }),
    t("routine.cwd", { dir: paths.root }),
    t("routine.state", {
      goal: contract.goal.slice(0, MAX_GOAL),
      gate: status?.task === contract.id ? `${status.status} (${status.at})` : t("routine.gate_none"),
    }),
    t("routine.commits", { list: commits.length === 0 ? "-" : commits.join(" | ") }),
    start === undefined ? t("routine.start_unknown") : t("routine.start", { command: start }),
    check === undefined ? t("routine.check_unknown") : t("routine.check", { command: check }),
  ];
  return capBytes(lines.join("\n"), ROUTINE_MAX_BYTES);
};
