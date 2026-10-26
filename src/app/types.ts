export interface AppTarget {
  readonly host: string;
  readonly port: number;
  readonly route: string;
}

export interface AppProbeRequest extends AppTarget {
  readonly start: string | undefined;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly status: number;
  readonly body: string | undefined;
}

export type AppProbeKind =
  "ok" | "crashed" | "no_port" | "wrong_status" | "body_mismatch" | "request_failed" | "no_start";

export interface AppProbeResult {
  readonly kind: AppProbeKind;
  readonly reused: boolean;
  readonly status?: number;
  readonly exitCode?: number | null;
  readonly output: string;
  readonly bodyExcerpt?: string;
  readonly stopped: boolean;
  readonly durationMs: number;
}

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_ROUTE = "/";
export const DEFAULT_STATUS = 200;
export const DEFAULT_APP_TIMEOUT_S = 60;
