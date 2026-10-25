import { toAbsolutePath } from "../core/brand.js";
import type { Check, CheckFinding, DoctorEnv } from "./types.js";

export const OS_KINDS = ["linux", "wsl", "macos", "windows", "other"] as const;

export type OsKind = (typeof OS_KINDS)[number];

export const detectOs = ({ platform, env, runtime }: Pick<DoctorEnv, "platform" | "env" | "runtime">): OsKind => {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform !== "linux") return "other";
  if (env["WSL_DISTRO_NAME"] !== undefined || env["WSL_INTEROP"] !== undefined) return "wsl";
  const version = runtime.readText(toAbsolutePath("/proc/version"));
  return version.ok && /microsoft/i.test(version.value) ? "wsl" : "linux";
};

const WSL_MOUNT = /^\/mnt\/[a-z](\/|$)/i;
const SYNCED = /(OneDrive|Dropbox|iCloud ?Drive|Mobile Documents|Google ?Drive)/i;
const NON_ASCII = /[^\x20-\x7e]/;

export interface PathTraits {
  readonly spaces: boolean;
  readonly nonAscii: boolean;
  readonly synced: boolean;
}

export const pathTraits = (path: string): PathTraits => ({
  spaces: path.includes(" "),
  nonAscii: NON_ASCII.test(path),
  synced: SYNCED.test(path),
});

export const checkOs: Check = (env) => {
  const os = detectOs(env);
  const findings: CheckFinding[] = [
    { check: "os", status: "ok", messageKey: `doctor.os.${os}`, params: { platform: env.platform } },
  ];
  if (os === "wsl" && WSL_MOUNT.test(env.cwd)) {
    findings.push({
      check: "path.wsl_mount",
      status: "warn",
      messageKey: "doctor.path.wsl_mount",
      params: { path: env.cwd },
      fixKey: "doctor.path.fix_wsl_mount",
    });
  }
  return findings;
};

export const checkPath: Check = ({ cwd }) => {
  const traits = pathTraits(cwd);
  const chars: CheckFinding =
    traits.spaces || traits.nonAscii
      ? {
          check: "path.chars",
          status: "warn",
          messageKey: "doctor.path.chars",
          params: { path: cwd },
          fixKey: "doctor.path.fix_chars",
        }
      : { check: "path.chars", status: "ok", messageKey: "doctor.path.plain", params: { path: cwd } };
  const synced: readonly CheckFinding[] = traits.synced
    ? [
        {
          check: "path.synced",
          status: "warn",
          messageKey: "doctor.path.synced",
          params: { path: cwd },
          fixKey: "doctor.path.fix_synced",
        },
      ]
    : [];
  return [chars, ...synced];
};
