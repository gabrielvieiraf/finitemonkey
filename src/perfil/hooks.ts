import { gitAt } from "../gate/git.js";
import { projectPaths } from "../gate/hooks/common.js";
import { headShaFromFiles } from "../git/head-file.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { agentCommitsPath, profileOrStart, updateDomain, writeProfile } from "./store.js";
import { clampScore, DOMAINS, type Profile } from "./types.js";
import { asksMechanism, domainsMentioned } from "./vocabulary.js";

const allow = { kind: "allow" } as const;

export const VOCABULARY_STEP = 2;
export const MECHANISM_STEP = 1;
export const PERSON_COMMIT_STEP = 2;
const KEEP_COMMITS = 200;
const SCAN_COMMITS = 20;

const fromPrompt = (profile: Profile, prompt: string): Profile => {
  const step = VOCABULARY_STEP + (asksMechanism(prompt) ? MECHANISM_STEP : 0);
  return domainsMentioned(prompt).reduce(
    (current, domain) =>
      updateDomain(current, domain, (entry) => ({ ...entry, knowledge: clampScore(entry.knowledge + step) })),
    profile,
  );
};

export const perfilPrompt: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const paths = projectPaths(input);
  if (paths === undefined || !comesFromPerson(prompt) || domainsMentioned(prompt).length === 0) return allow;
  if (input.runtime.stat(paths.dir)?.kind !== "dir") return allow;
  writeProfile(input.runtime, paths, fromPrompt(profileOrStart(input.runtime, paths), prompt));
  return allow;
};

const COMMIT = /\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+commit\b/;

const knownCommits = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];

export const perfilAgentCommit: HookHandler = (input) => {
  const raw = input.payload.raw;
  if (!["Bash", "PowerShell"].includes(toolName(raw))) return allow;
  if (!COMMIT.test(textField(toolInput(raw), "command") ?? "")) return allow;
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return allow;
  const head = gitAt(input.runtime, paths.root).out(["rev-parse", "HEAD"])?.trim();
  if (head === undefined || head === "") return allow;
  const stored = readJsonFile(input.runtime, agentCommitsPath(paths));
  writeJsonFile(input.runtime, agentCommitsPath(paths), {
    agent: [...knownCommits(stored?.["agent"]), head].slice(-KEEP_COMMITS),
    seen: knownCommits(stored?.["seen"]),
  });
  return allow;
};

export const personCommits = (log: string, agent: ReadonlySet<string>, seen: ReadonlySet<string>): readonly string[] =>
  log
    .split("\n")
    .map((line) => line.trim())
    .filter((sha) => sha !== "" && !agent.has(sha) && !seen.has(sha));

export const perfilSession: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return allow;
  const stored = readJsonFile(input.runtime, agentCommitsPath(paths));
  const head = headShaFromFiles(input.runtime, paths.root);
  if (head === undefined || stored?.["head"] === head) return allow;
  const agent = new Set(knownCommits(stored?.["agent"]));
  const seen = new Set(knownCommits(stored?.["seen"]));
  const log = gitAt(input.runtime, paths.root).out(["log", "--format=%H", "-n", String(SCAN_COMMITS)]) ?? "";
  const headField = { head };
  if (agent.size === 0 && seen.size === 0) {
    writeJsonFile(input.runtime, agentCommitsPath(paths), {
      agent: [],
      seen: personCommits(log, agent, seen),
      ...headField,
    });
    return allow;
  }
  const fresh = personCommits(log, agent, seen);
  writeJsonFile(input.runtime, agentCommitsPath(paths), {
    agent: [...agent],
    seen: [...seen, ...fresh].slice(-KEEP_COMMITS),
    ...headField,
  });
  if (fresh.length === 0) return allow;
  const step = Math.min(fresh.length, 3) * PERSON_COMMIT_STEP;
  const profile = DOMAINS.reduce(
    (current, domain) => updateDomain(current, domain, (entry) => ({ ...entry, tool: clampScore(entry.tool + step) })),
    profileOrStart(input.runtime, paths),
  );
  writeProfile(input.runtime, paths, profile);
  return allow;
};

export const PERFIL_HANDLERS: HookHandlers = {
  UserPromptSubmit: [perfilPrompt],
  PostToolUse: [perfilAgentCommit],
  SessionStart: [perfilSession],
};
