import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { AppProbeKind, AppProbeResult } from "./types.js";

const KINDS: readonly AppProbeKind[] = [
  "ok",
  "crashed",
  "no_port",
  "wrong_status",
  "body_mismatch",
  "request_failed",
  "no_start",
];

const optionalNumber = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

export const parseAppCheck = (stdout: string): AppProbeResult | undefined => {
  const envelope = parseJsonObject(stdout.trim());
  if (!envelope.ok) return undefined;
  const data = envelope.value["data"];
  if (!isRecord(data)) return undefined;
  const kind = KINDS.find((item) => item === data["kind"]);
  const { output, reused, stopped, durationMs, exitCode, bodyExcerpt } = data;
  if (kind === undefined || typeof output !== "string" || typeof reused !== "boolean" || typeof stopped !== "boolean")
    return undefined;
  const status = optionalNumber(data["status"]);
  return {
    kind,
    output,
    reused,
    stopped,
    durationMs: optionalNumber(durationMs) ?? 0,
    ...(status === undefined ? {} : { status }),
    ...(typeof exitCode === "number" || exitCode === null ? { exitCode } : {}),
    ...(typeof bodyExcerpt === "string" ? { bodyExcerpt } : {}),
  };
};
