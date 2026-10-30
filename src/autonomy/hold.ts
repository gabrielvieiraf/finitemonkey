import { basename } from "node:path";

import { nowMs } from "../core/clock.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { projectPaths } from "../gate/hooks/common.js";
import { destructiveHit } from "../git/destructive.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { PROD_PROGRAMS } from "../prod/guard.js";
import { toolName } from "../secrets/guards/tool-input.js";
import { normalizeCommand } from "../shell/normalize.js";
import type { ShellCommand } from "../shell/types.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile } from "../task/state.js";

export const UNATTENDED_FILE = "unattended.json";
export const HOLD_EVENT = "unattended_hold";

export interface UnattendedMarker {
  readonly run: string;
  readonly until: string;
}

export const readMarker = (
  runtime: Pick<Runtime, "readText" | "now">,
  paths: FmPaths,
): UnattendedMarker | undefined => {
  const raw = readJsonFile(runtime, paths.cache(UNATTENDED_FILE));
  const run = raw?.["run"];
  const until = raw?.["until"];
  if (typeof run !== "string" || typeof until !== "string") return undefined;
  return nowMs(runtime) <= Date.parse(until) ? { run, until } : undefined;
};

const GIT_DENIED = new Set(["push", "reset", "clean", "rebase", "filter-branch", "filter-repo", "update-ref", "gc"]);
const PUBLISHERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const DEPLOYERS = new Set([
  "vercel",
  "netlify",
  "fly",
  "flyctl",
  "heroku",
  "firebase",
  "aws",
  "gcloud",
  "az",
  "wrangler",
  "railway",
  "render",
  "doctl",
  "eb",
  "serverless",
  "sls",
  "pulumi",
]);

const programOf = (command: ShellCommand): string =>
  basename(command.program.replace(/\\/g, "/"))
    .toLowerCase()
    .replace(/\.exe$/, "");

const firstWord = (args: readonly string[]): string => args.find((arg) => !arg.startsWith("-")) ?? "";

const recursiveRm = (args: readonly string[]): boolean =>
  args.some((arg) => arg === "--recursive" || /^-[A-Za-z]*[rR]/.test(arg));

export const unattendedReason = (command: ShellCommand): string | undefined => {
  const program = programOf(command);
  const sub = firstWord(command.args);
  if (program === "git" && (GIT_DENIED.has(sub) || (sub === "branch" && command.args.includes("-D"))))
    return `git ${sub}`;
  if (program === "git" && sub === "stash" && ["drop", "clear"].includes(command.args[1] ?? "")) return "git stash";
  if (program === "rm" && recursiveRm(command.args)) return "rm -r";
  if (PROD_PROGRAMS.has(program)) return program;
  if (DEPLOYERS.has(program)) return program;
  if (PUBLISHERS.has(program) && ["publish", "deploy", "unpublish"].includes(sub)) return `${program} ${sub}`;
  if (program === "gh" && ["release", "pr", "workflow", "repo", "secret"].includes(sub)) return `gh ${sub}`;
  if (program === "terraform" && ["apply", "destroy", "import"].includes(sub)) return `terraform ${sub}`;
  if (program === "kubectl" || program === "helm") return program;
  return undefined;
};

const commandText = (raw: JsonObject): string | undefined => {
  const input = raw["tool_input"];
  const command = isRecord(input) ? input["command"] : undefined;
  return typeof command === "string" ? command : undefined;
};

export const holdReason = (text: string, context: Parameters<typeof destructiveHit>[1]): string | undefined => {
  const parsed = normalizeCommand(text);
  for (const command of parsed.commands) {
    const reason = unattendedReason(command) ?? destructiveHit(command, context)?.rule;
    if (reason !== undefined) return reason;
  }
  return undefined;
};

export const unattendedHold: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined) return { kind: "allow" };
  const marker = readMarker(input.runtime, paths);
  if (marker === undefined || toolName(input.payload) !== "Bash") return { kind: "allow" };
  const text = commandText(input.payload.raw) ?? "";
  const reason = holdReason(text, { runtime: input.runtime, home: input.runtime.homeDir(), env: input.env });
  if (reason === undefined) return { kind: "allow" };
  logEvent(input.runtime, paths, HOLD_EVENT, { run: marker.run, reason, command: text.slice(0, 200) });
  return { kind: "block", reason: input.t("autonomy.hold", { reason }) };
};

export const UNATTENDED_HANDLERS: HookHandlers = { PreToolUse: [unattendedHold] };
