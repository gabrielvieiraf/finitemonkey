import type { AbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import type { MessageKey } from "../i18n/catalogs.js";
import type { Params } from "../i18n/translate.js";

export const CHECK_STATUSES = ["ok", "warn", "fail"] as const;

export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface CheckFinding {
  readonly check: string;
  readonly status: CheckStatus;
  readonly messageKey: MessageKey;
  readonly params?: Params;
  readonly fixKey?: MessageKey;
}

export type DoctorRuntime = Pick<
  Runtime,
  "nodeVersion" | "probe" | "readText" | "stat" | "listDir" | "git" | "now" | "realpath" | "homeDir"
>;

export interface DoctorEnv {
  readonly platform: NodeJS.Platform;
  readonly env: Env;
  readonly cwd: AbsolutePath;
  readonly root: AbsolutePath;
  readonly runtime: DoctorRuntime;
}

export type Check = (env: DoctorEnv) => readonly CheckFinding[];

export const finding = (
  check: string,
  status: CheckStatus,
  messageKey: MessageKey,
  params?: Params,
  fixKey?: MessageKey,
): CheckFinding => ({
  check,
  status,
  messageKey,
  ...(params === undefined ? {} : { params }),
  ...(fixKey === undefined ? {} : { fixKey }),
});
