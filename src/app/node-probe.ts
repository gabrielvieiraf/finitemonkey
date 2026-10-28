import { portOpen, type RunningApp, startApp, stopApp, waitForPort } from "./node-process.js";
import type { AppProbeRequest, AppProbeResult } from "./types.js";

const BODY_EXCERPT = 200;
const MAX_BODY = 256 * 1024;

const url = (request: AppProbeRequest): string => {
  const host = request.host.includes(":") ? `[${request.host}]` : request.host;
  return `http://${host}:${String(request.port)}${request.route.startsWith("/") ? "" : "/"}${request.route}`;
};

type Answer = Pick<AppProbeResult, "kind" | "status" | "bodyExcerpt">;

const ask = async (request: AppProbeRequest, deadline: number): Promise<Answer> => {
  try {
    const response = await fetch(url(request), {
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
    const body = (await response.text()).slice(0, MAX_BODY);
    const excerpt = body.slice(0, BODY_EXCERPT);
    if (response.status !== request.status)
      return { kind: "wrong_status", status: response.status, bodyExcerpt: excerpt };
    if (request.body !== undefined && !body.includes(request.body)) {
      return { kind: "body_mismatch", status: response.status, bodyExcerpt: excerpt };
    }
    return { kind: "ok", status: response.status };
  } catch (error) {
    return { kind: "request_failed", bodyExcerpt: error instanceof Error ? error.message : String(error) };
  }
};

const finish = async (
  app: RunningApp | undefined,
  answer: Pick<AppProbeResult, "kind" | "status" | "bodyExcerpt" | "exitCode">,
  started: number,
): Promise<AppProbeResult> => {
  const stopped = app === undefined ? true : await stopApp(app);
  return {
    ...answer,
    reused: app === undefined,
    output: app?.output() ?? "",
    stopped,
    durationMs: Date.now() - started,
  };
};

export const probeApp = async (request: AppProbeRequest): Promise<AppProbeResult> => {
  const started = Date.now();
  const deadline = started + request.timeoutMs;
  if (await portOpen(request.host, request.port)) return finish(undefined, await ask(request, deadline), started);
  if (request.start === undefined) return finish(undefined, { kind: "no_start" }, started);
  const app = startApp(request.start, request.cwd, request.port);
  const port = await waitForPort(app, request.host, request.port, deadline);
  if (port === "exited") return finish(app, { kind: "crashed", exitCode: app.exited()?.code ?? null }, started);
  if (port === "timeout") return finish(app, { kind: "no_port" }, started);
  return finish(app, await ask(request, deadline), started);
};

export interface HeaderAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

export const fetchHeaders = async (url: string, timeoutMs: number): Promise<HeaderAnswer | undefined> => {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()) };
  } catch {
    return undefined;
  }
};
