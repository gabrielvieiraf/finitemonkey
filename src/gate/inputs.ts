import { join } from "node:path";

import type { AbsolutePath } from "../core/brand.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import type { Evidence, EvidenceInputs } from "../evidence/types.js";
import { configAt, configList, type ConfigTree } from "../git/project-config.js";
import { sha256Hex as sha256 } from "../secrets/fingerprint.js";

export const EVIDENCE_INPUTS_FEATURE = "evidence-inputs";

export const LOCKFILES: readonly string[] = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
];

export const DEFAULT_ENV_ALLOWLIST: readonly string[] = ["NODE_ENV", "NODE_OPTIONS", "TZ", "PYTHONPATH", "VIRTUAL_ENV"];

export const DEFAULT_MAX_AGE_MINUTES = 60;

interface ToolProbe {
  readonly markers: readonly string[];
  readonly tool: string;
  readonly args: readonly string[];
}

const PROBES: readonly ToolProbe[] = [
  { markers: ["package.json"], tool: "node", args: ["--version"] },
  { markers: ["pyproject.toml", "requirements.txt"], tool: "python3", args: ["--version"] },
  { markers: ["go.mod"], tool: "go", args: ["version"] },
];

const PROBE_TIMEOUT_MS = 5000;
const SHORT = 16;

export interface InputsConfig {
  readonly env: readonly string[];
  readonly maxAgeMs: number;
}

export const inputsConfig = (tree: ConfigTree): InputsConfig => {
  const declared = configAt(tree, "evidence", "env");
  const raw = configAt(tree, "evidence", "maxAgeMinutes");
  const minutes = typeof raw === "string" ? Number(raw) : Number.NaN;
  return {
    env: declared === undefined ? DEFAULT_ENV_ALLOWLIST : configList(tree, "evidence", "env"),
    maxAgeMs: (Number.isInteger(minutes) && minutes > 0 ? minutes : DEFAULT_MAX_AGE_MINUTES) * 60_000,
  };
};

const exists = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, file: string): boolean =>
  runtime.readText(toAbsolutePath(join(root, file))).ok;

const version = (runtime: Pick<Runtime, "exec">, root: AbsolutePath, probe: ToolProbe): string => {
  const result = runtime.exec({ command: probe.tool, args: probe.args, cwd: root, timeoutMs: PROBE_TIMEOUT_MS });
  if (!result.found || result.exitCode !== 0) return "missing";
  return `${result.stdout}${result.stderr}`.trim().split(/\r?\n/)[0] ?? "";
};

export const currentInputs = (
  runtime: Pick<Runtime, "readText" | "exec">,
  root: AbsolutePath,
  env: Env,
  config: InputsConfig,
): EvidenceInputs => {
  const lockfiles = Object.fromEntries(
    LOCKFILES.flatMap((file) => {
      const text = runtime.readText(toAbsolutePath(join(root, file)));
      return text.ok ? [[file, sha256(text.value).slice(0, SHORT)] as const] : [];
    }),
  );
  const tools = Object.fromEntries(
    PROBES.filter((probe) => probe.markers.some((marker) => exists(runtime, root, marker))).map(
      (probe) => [probe.tool, version(runtime, root, probe)] as const,
    ),
  );
  const vars = Object.fromEntries(
    config.env.map((name) => {
      const value = env[name];
      return [name, value === undefined ? "" : sha256(value).slice(0, SHORT)] as const;
    }),
  );
  return { cwd: root, lockfiles, tools, env: vars };
};

const changedKeys = (
  label: string,
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): readonly string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key])
    .sort()
    .map((key) => `${label}:${key}`);

export const inputsChanged = (prior: EvidenceInputs | undefined, now: EvidenceInputs): readonly string[] => {
  if (prior === undefined) return ["inputs"];
  return [
    ...changedKeys("lockfile", prior.lockfiles, now.lockfiles),
    ...changedKeys("tool", prior.tools, now.tools),
    ...changedKeys("env", prior.env, now.env),
  ];
};

export const COMMAND_KINDS: readonly string[] = ["command", "tests"];

export const staleReasons = (
  prior: Evidence,
  now: { readonly inputs: EvidenceInputs; readonly treeHash: string; readonly atMs: number; readonly maxAgeMs: number },
): readonly string[] => [
  ...(prior.treeHash === now.treeHash ? [] : ["tree"]),
  ...inputsChanged(prior.inputs, now.inputs),
  ...(COMMAND_KINDS.includes(prior.kind) && now.atMs - Date.parse(prior.at) >= now.maxAgeMs ? ["age"] : []),
];
