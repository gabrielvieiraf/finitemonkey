import { CONTRACT_FILE } from "../apicontract/registry.js";
import { detectStack, hasWebStack } from "../appsec/stack.js";
import { ARCH_FILE } from "../arch/config.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { CONFIG_FILE, configAt, parseConfigYaml } from "../git/project-config.js";
import { ONBOARD_FILE, onboardChecks, parseOnboard } from "../onboard/state.js";
import { detectPython, PIP_DEFAULT, pythonChecks } from "../python/detect.js";
import type { AcceptanceCheck, TaskContract } from "./types.js";

export const IMPLICIT_ID = "implicit";

export interface ProjectFiles {
  readonly read: (relative: string) => string | undefined;
  readonly exists: (relative: string) => boolean;
}

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
] as const;

export const packageManager = (files: ProjectFiles): string =>
  LOCKFILES.find(([file]) => files.exists(file))?.[1] ?? "npm";

export const scriptChecks = (files: ProjectFiles): readonly AcceptanceCheck[] => {
  const text = files.read("package.json");
  if (text === undefined) return [];
  const parsed = parseJsonObject(text);
  const scripts = parsed.ok ? parsed.value["scripts"] : undefined;
  if (!isRecord(scripts)) return [];
  const pm = packageManager(files);
  const has = (name: string): boolean => typeof scripts[name] === "string";
  const typecheck = ["typecheck", "type-check", "tsc"].find(has);
  const checks: AcceptanceCheck[] = [];
  if (typecheck !== undefined) checks.push({ id: "typecheck", kind: "command", run: `${pm} run ${typecheck}` });
  if (has("lint")) checks.push({ id: "lint", kind: "command", run: `${pm} run lint` });
  const test = scripts["test"];
  if (typeof test === "string" && !test.includes("no test specified"))
    checks.push({ id: "test", kind: "tests", run: `${pm} run test` });
  if (checks.length === 0 && has("check")) checks.push({ id: "check", kind: "command", run: `${pm} run check` });
  return checks;
};

const OTHER_STACKS = [
  ["Cargo.toml", "cargo test"],
  ["go.mod", "go test ./..."],
] as const;

export const detectChecks = (files: ProjectFiles): readonly AcceptanceCheck[] => {
  const scripts = scriptChecks(files);
  if (scripts.length > 0) return scripts;
  const found = OTHER_STACKS.find(([file]) => files.exists(file));
  if (found !== undefined) return [{ id: "test", kind: "tests", run: found[1] }];
  const python = detectPython(files.read, (file) => files.exists(file));
  return python === undefined && !files.exists("pytest.ini") ? [] : pythonChecks(python ?? PIP_DEFAULT);
};

const projectChecks = (files: ProjectFiles): readonly AcceptanceCheck[] => {
  const onboard = parseOnboard(files.read(ONBOARD_FILE));
  return onboard !== undefined && onboard.commands.length > 0 ? onboardChecks(onboard) : detectChecks(files);
};

const cliDeclared = (files: ProjectFiles): boolean => {
  const text = files.read(CONFIG_FILE);
  return text !== undefined && typeof configAt(parseConfigYaml(text), "cli", "bin") === "string";
};

export const implicitContract = (files: ProjectFiles): TaskContract => {
  const commands = projectChecks(files);
  const hasTests = commands.some((check) => check.kind === "tests");
  return {
    id: IMPLICIT_ID,
    goal: "",
    size: "S",
    scope: { paths: [], testsProtected: true },
    acceptance: [
      ...commands,
      ...(hasTests ? [] : [{ id: "tests", kind: "tests" as const }]),
      { id: "placeholders", kind: "placeholders" },
      { id: "secrets", kind: "secrets" },
      ...(hasWebStack(detectStack(files.read)) ? [{ id: "appsec", kind: "appsec" as const }] : []),
      { id: "prose", kind: "prose" },
      { id: "worktree", kind: "worktree" },
      { id: "merge", kind: "merge" },
      { id: "callers", kind: "callers" },
      { id: "quality", kind: "quality" },
      { id: "slop", kind: "slop" },
      { id: "regression", kind: "regression" },
      ...(files.exists(ARCH_FILE) ? [{ id: "arch", kind: "arch" as const }] : []),
      ...(files.exists(CONTRACT_FILE) ? [{ id: "contract", kind: "contract" as const }] : []),
      ...(cliDeclared(files) ? [{ id: "cli", kind: "cli" as const }] : []),
      { id: "pr", kind: "pr", requireOpen: false },
      { id: "diff", kind: "diff" },
    ],
    decisionsNeeded: [],
    implicit: true,
  };
};
