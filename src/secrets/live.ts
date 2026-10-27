import type { ExecRequest, ExecResult } from "../core/runtime.js";

export interface LiveProbe {
  readonly host: string;
  readonly path: string;
  readonly headers: (key: string) => readonly string[];
}

const bearer = (key: string): readonly string[] => [`Authorization: Bearer ${key}`];

export const LIVE_PROBES = {
  github: {
    host: "api.github.com",
    path: "/user",
    headers: (key) => [...bearer(key), "User-Agent: finitemonkey"],
  },
  stripe: { host: "api.stripe.com", path: "/v1/balance", headers: bearer },
  openai: { host: "api.openai.com", path: "/v1/models", headers: bearer },
  anthropic: {
    host: "api.anthropic.com",
    path: "/v1/models",
    headers: (key) => [`x-api-key: ${key}`, "anthropic-version: 2023-06-01"],
  },
  digitalocean: { host: "api.digitalocean.com", path: "/v2/account", headers: bearer },
  cloudflare: { host: "api.cloudflare.com", path: "/client/v4/user/tokens/verify", headers: bearer },
  asaas: {
    host: "api.asaas.com",
    path: "/v3/finance/balance",
    headers: (key) => [`access_token: ${key}`, "User-Agent: finitemonkey"],
  },
} as const satisfies Readonly<Record<string, LiveProbe>>;

export type LiveProvider = keyof typeof LIVE_PROBES;

export const LIVE_PROVIDERS = Object.keys(LIVE_PROBES).filter((name): name is LiveProvider => name in LIVE_PROBES);

export const LIVE_HOSTS: readonly string[] = LIVE_PROVIDERS.map((name) => LIVE_PROBES[name].host);

export const liveProvider = (name: string | undefined): LiveProvider | undefined =>
  LIVE_PROVIDERS.find((provider) => provider === name);

export const LIVE_TIMEOUT_MS = 15_000;

export const liveRequest = (provider: LiveProvider, key: string, cwd: ExecRequest["cwd"]): ExecRequest => {
  const probe = LIVE_PROBES[provider];
  return {
    command: "curl",
    args: [
      "--silent",
      "--show-error",
      "--proto",
      "=https",
      "--max-time",
      "10",
      "--header",
      "@-",
      "--write-out",
      "\n%{http_code}",
      `https://${probe.host}${probe.path}`,
    ],
    cwd,
    timeoutMs: LIVE_TIMEOUT_MS,
    input: `${probe.headers(key).join("\n")}\n`,
  };
};

export type LiveVerdict = "live" | "rejected" | "unknown" | "unreachable";

export interface LiveOutcome {
  readonly verdict: LiveVerdict;
  readonly status?: number;
}

export const liveOutcome = (result: ExecResult): LiveOutcome => {
  if (!result.found || result.exitCode !== 0) return { verdict: "unreachable" };
  const status = Number.parseInt(result.stdout.trimEnd().split("\n").at(-1) ?? "", 10);
  if (!Number.isInteger(status) || status === 0) return { verdict: "unreachable" };
  if (status >= 200 && status < 300) return { verdict: "live", status };
  if (status === 401 || status === 403) return { verdict: "rejected", status };
  return { verdict: "unknown", status };
};
