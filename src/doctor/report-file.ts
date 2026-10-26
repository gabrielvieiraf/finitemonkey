import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Envelope } from "../core/result.js";
import { HOOK_FAILURE_EVENT } from "../hooks/failure-log.js";
import { stamp } from "../install/apply.js";
import { maskText } from "../mask/mask.js";
import { fmPaths } from "../task/paths.js";
import { detectOs } from "./system.js";
import { PROBE_TIMEOUT_MS } from "./tools.js";
import type { DoctorEnv } from "./types.js";

export const REPORTS_DIR = ".finitemonkey/reports";
export const MAX_FAILURES = 20;

const FENCE = "```";

const toolVersion = (env: DoctorEnv, command: string): string => {
  const result = env.runtime.probe(command, ["--version"], PROBE_TIMEOUT_MS.claude);
  return result.ok ? (result.stdout.trim().split("\n")[0] ?? "") : "not found";
};

export const lastHookFailures = (env: DoctorEnv): readonly string[] => {
  const text = env.runtime.readText(fmPaths(env.root).log);
  if (!text.ok) return [];
  return text.value
    .split("\n")
    .filter((line) => {
      const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
      return parsed?.ok === true && isRecord(parsed.value) && parsed.value["event"] === HOOK_FAILURE_EVENT;
    })
    .slice(-MAX_FAILURES);
};

const withoutHome = (text: string, home: string): string => (home.length > 1 ? text.split(home).join("~") : text);

export const reportMarkdown = (env: DoctorEnv, ctx: Pick<Ctx, "version" | "lang">, envelope: Envelope): string => {
  const failures = lastHookFailures(env);
  const lines = [
    "# Finite Monkey doctor report",
    "",
    `- Generated: ${env.runtime.now()}`,
    `- finitemonkey: ${ctx.version}`,
    `- Node.js: ${env.runtime.nodeVersion}`,
    `- Claude Code: ${toolVersion(env, "claude")}`,
    `- git: ${toolVersion(env, "git")}`,
    `- OS: ${detectOs(env)} (${env.platform})`,
    `- Language: ${ctx.lang}`,
    "",
    "## doctor --json",
    "",
    `${FENCE}json`,
    JSON.stringify(envelope, null, 2),
    FENCE,
    "",
    `## Last hook failures (${String(failures.length)})`,
    "",
    ...(failures.length === 0 ? ["None in .finitemonkey/log.jsonl."] : [`${FENCE}jsonl`, ...failures, FENCE]),
    "",
  ];
  return maskText(withoutHome(lines.join("\n"), env.runtime.homeDir()));
};

export const reportPath = (env: DoctorEnv): AbsolutePath =>
  toAbsolutePath(join(env.root, ...REPORTS_DIR.split("/"), `doctor-${stamp(env.runtime.now())}.md`));
