import type { Check } from "./types.js";

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
  return [{ check: "node", status: "ok", messageKey: "doctor.node.ok", params: { version } }];
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
  return [{ check: "claude", status: "ok", messageKey: "doctor.claude.ok", params: { version } }];
};
