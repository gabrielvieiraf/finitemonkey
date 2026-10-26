import { ON_FAILURE_MIN, parseClaudeVersion } from "../install/claude-version.js";
import { type Check, type CheckFinding, finding } from "./types.js";

export const MIN_NODE_MAJOR = 20;
export const MIN_GIT = { major: 2, minor: 38 } as const;
export const PROBE_TIMEOUT_MS = { git: 5000, claude: 8000 } as const;

export interface GitVersion {
  readonly major: number;
  readonly minor: number;
}

export const parseGitVersion = (output: string): GitVersion | undefined => {
  const match = /(\d+)\.(\d+)/.exec(output);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]) };
};

const isOlder = (version: GitVersion, min: GitVersion): boolean =>
  version.major < min.major || (version.major === min.major && version.minor < min.minor);

export const NODE_END_OF_LIFE: Readonly<Record<number, string>> = {
  18: "2025-04-30",
  19: "2023-06-01",
  20: "2026-04-30",
  21: "2024-06-01",
  22: "2027-04-30",
  23: "2025-06-01",
  24: "2028-04-30",
  25: "2026-06-01",
  26: "2029-04-30",
};

const endOfLife = (major: number, now: string, version: string): readonly CheckFinding[] => {
  const date = NODE_END_OF_LIFE[major];
  if (date === undefined || Date.parse(now) <= Date.parse(`${date}T23:59:59Z`)) return [];
  return [finding("node.support", "warn", "doctor.node.unsupported", { version, date }, "doctor.node.fix_unsupported")];
};

export const checkNode: Check = ({ runtime }) => {
  const version = runtime.nodeVersion.replace(/^v/, "");
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return [
      {
        check: "node",
        status: "fail",
        messageKey: "doctor.node.old",
        params: { version, min: MIN_NODE_MAJOR },
        fixKey: "doctor.node.fix",
      },
    ];
  }
  return [
    { check: "node", status: "ok", messageKey: "doctor.node.ok", params: { version } },
    ...endOfLife(major, runtime.now(), version),
  ];
};

export const checkGit: Check = ({ runtime }) => {
  const result = runtime.probe("git", ["--version"], PROBE_TIMEOUT_MS.git);
  if (!result.found || !result.ok) {
    return [{ check: "git", status: "fail", messageKey: "doctor.git.missing", fixKey: "doctor.git.fix" }];
  }
  const parsed = parseGitVersion(result.stdout);
  const version = parsed === undefined ? result.stdout : `${String(parsed.major)}.${String(parsed.minor)}`;
  if (parsed === undefined || isOlder(parsed, MIN_GIT)) {
    const min = `${String(MIN_GIT.major)}.${String(MIN_GIT.minor)}`;
    return [
      {
        check: "git",
        status: "warn",
        messageKey: "doctor.git.old",
        params: { version, min },
        fixKey: "doctor.git.fix_old",
      },
    ];
  }
  return [{ check: "git", status: "ok", messageKey: "doctor.git.ok", params: { version } }];
};

const isBelow = (version: readonly number[], min: readonly number[]): boolean => {
  for (const [index, part] of min.entries()) {
    const value = version[index] ?? 0;
    if (value !== part) return value < part;
  }
  return false;
};

export const CLAUDE_MIN = ON_FAILURE_MIN.join(".");

const claudeMinimum = (stdout: string, version: string): readonly CheckFinding[] => {
  const parsed = parseClaudeVersion(stdout);
  if (parsed === undefined || !isBelow(parsed, ON_FAILURE_MIN)) return [];
  return [
    finding("claude.version", "warn", "doctor.claude.old", { version, min: CLAUDE_MIN }, "doctor.claude.fix_old"),
  ];
};

export const checkClaude: Check = ({ runtime }) => {
  const result = runtime.probe("claude", ["--version"], PROBE_TIMEOUT_MS.claude);
  if (result.timedOut) {
    return [
      { check: "claude", status: "warn", messageKey: "doctor.claude.timeout", fixKey: "doctor.claude.fix_timeout" },
    ];
  }
  if (!result.found || !result.ok) {
    return [{ check: "claude", status: "warn", messageKey: "doctor.claude.missing", fixKey: "doctor.claude.fix" }];
  }
  const version = /\d+\.\d+\.\d+/.exec(result.stdout)?.[0] ?? result.stdout;
  return [
    { check: "claude", status: "ok", messageKey: "doctor.claude.ok", params: { version } },
    ...claudeMinimum(result.stdout, version),
  ];
};
