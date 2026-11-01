import type { AbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { fmPaths } from "../task/paths.js";
import { readState, readTrust } from "../task/state.js";
import { TASK_ID } from "../task/types.js";
import { DAMAGE_GUARDS, GUARD_MODES, type GuardMode, KNOWN_GUARDS } from "./policy.js";

export interface TaskGuards {
  readonly task: string;
  readonly approved: Readonly<Record<string, GuardMode>>;
  readonly pending: Readonly<Record<string, GuardMode>>;
}

const isDamage = (id: string): boolean => DAMAGE_GUARDS.some((guard) => guard === id);

export const parseTaskGuards = (value: unknown, issues: string[]): Readonly<Record<string, GuardMode>> => {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    issues.push("guards: must be a mapping of guard to mode");
    return {};
  }
  const modes: Record<string, GuardMode> = {};
  for (const [id, raw] of Object.entries(value)) {
    const mode = GUARD_MODES.find((option) => option === raw);
    if (!KNOWN_GUARDS.includes(id)) issues.push(`guards.${id}: unknown guard`);
    else if (mode === undefined) issues.push(`guards.${id}: use ${GUARD_MODES.join(", ")}`);
    else if (isDamage(id) && mode !== "active")
      issues.push(`guards.${id}: a damage guard cannot be weakened by a task`);
    else modes[id] = mode;
  }
  return modes;
};

const guardsIn = (text: string | undefined): Readonly<Record<string, GuardMode>> => {
  if (text === undefined || !/^guards\s*:/m.test(text)) return {};
  const yaml = parseYaml(text);
  return yaml.ok && isRecord(yaml.value) ? parseTaskGuards(yaml.value["guards"], []) : {};
};

export const loadTaskGuards = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): TaskGuards | undefined => {
  const paths = fmPaths(root);
  const task = readState(runtime, paths).active;
  if (task === undefined || !TASK_ID.test(task)) return undefined;
  const disk = runtime.readText(paths.task(task));
  const lock = runtime.readText(paths.trust);
  const approved = lock.ok && lock.value.includes("guards:") ? guardsIn(readTrust(runtime, paths).approved[task]) : {};
  const pending = guardsIn(disk.ok ? disk.value : undefined);
  return Object.keys(approved).length + Object.keys(pending).length === 0 ? undefined : { task, approved, pending };
};
