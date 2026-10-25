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

export interface DoctorEnv {
  readonly platform: NodeJS.Platform;
  readonly env: Env;
  readonly cwd: AbsolutePath;
  readonly runtime: Pick<Runtime, "nodeVersion" | "probe" | "readText">;
}

export type Check = (env: DoctorEnv) => readonly CheckFinding[];
