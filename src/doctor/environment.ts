import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { detectOs } from "./system.js";
import { type Check, type CheckFinding, type DoctorEnv, finding } from "./types.js";

export const AUTH_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
] as const;

const SANDBOX_TOOLS = [
  { command: "bwrap", args: ["--version"] },
  { command: "socat", args: ["-V"] },
] as const;

const PROBE_MS = 5000;

export const checkSandbox: Check = (env) => {
  const os = detectOs(env);
  if (os === "windows") {
    return [finding("sandbox", "warn", "doctor.sandbox.windows", {}, "doctor.sandbox.fix_windows")];
  }
  if (os === "macos") return [finding("sandbox", "ok", "doctor.sandbox.ok")];
  if (os === "other") return [];
  const missing = SANDBOX_TOOLS.filter(({ command, args }) => !env.runtime.probe(command, args, PROBE_MS).found).map(
    ({ command }) => command,
  );
  if (missing.length === 0) return [finding("sandbox", "ok", "doctor.sandbox.ok")];
  return [
    finding("sandbox", "warn", "doctor.sandbox.missing", { tools: missing.join(", ") }, "doctor.sandbox.fix_missing"),
  ];
};

const EXECUTABLES: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  win32: ["finitemonkey.cmd", "finitemonkey.exe", "finitemonkey.ps1"],
};

export const pathDirs = ({ env, platform }: Pick<DoctorEnv, "env" | "platform">): readonly string[] => {
  const raw = env["PATH"] ?? env["Path"] ?? "";
  return [...new Set(raw.split(platform === "win32" ? ";" : ":").filter((dir) => dir !== ""))];
};

export const copiesOnPath = (env: DoctorEnv): readonly string[] => {
  const names = EXECUTABLES[env.platform] ?? ["finitemonkey"];
  const found = pathDirs(env).flatMap((dir) =>
    names
      .map((name) => toAbsolutePath(join(dir, name)))
      .filter((path) => env.runtime.stat(path)?.kind === "file")
      .map((path) => env.runtime.realpath(path)),
  );
  const byDir = new Map(found.map((path) => [path.replace(/\.(cmd|exe|ps1)$/i, ""), path]));
  return [...byDir.values()];
};

export const checkPathCopies: Check = (env) => {
  const copies = copiesOnPath(env);
  if (copies.length < 2) return [];
  return [
    finding(
      "path.copies",
      "warn",
      "doctor.path.copies",
      { count: copies.length, paths: copies.join(", ") },
      "doctor.path.fix_copies",
    ),
  ];
};

const unsetCommand = (platform: NodeJS.Platform, names: readonly string[]): string =>
  platform === "win32" ? names.map((name) => `Remove-Item Env:${name}`).join("; ") : `unset ${names.join(" ")}`;

export const checkAuthVariables: Check = ({ env, platform }): readonly CheckFinding[] => {
  const set = AUTH_VARIABLES.filter((name) => (env[name] ?? "") !== "");
  if (set.length === 0) return [];
  return [
    finding(
      "auth.env",
      "warn",
      "doctor.auth.env",
      { names: set.join(", "), command: unsetCommand(platform, set) },
      "doctor.auth.fix_env",
    ),
  ];
};
