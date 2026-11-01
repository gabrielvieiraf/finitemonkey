import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { POWERSHELL, toastArgs, toastProbeArgs, WINDOWS_TIMEOUT_MS } from "./windows.js";

export interface Notice {
  readonly title: string;
  readonly body: string;
}

export interface NotifyCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export type Channel = "desktop" | "bell";

const quoted = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const UNIX_TIMEOUT_MS = 2000;

export const notifyCommand = (platform: string, notice: Notice): NotifyCommand | undefined => {
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-e", `display notification ${quoted(notice.body)} with title ${quoted(notice.title)}`],
      timeoutMs: UNIX_TIMEOUT_MS,
    };
  }
  if (platform === "linux") {
    return { command: "notify-send", args: [notice.title, notice.body], timeoutMs: UNIX_TIMEOUT_MS };
  }
  if (platform === "win32") {
    return { command: POWERSHELL, args: toastArgs(notice.title, notice.body), timeoutMs: WINDOWS_TIMEOUT_MS };
  }
  return undefined;
};

export const probeCommand = (platform: string): NotifyCommand | undefined => {
  if (platform === "darwin") return { command: "osascript", args: ["-e", "return 1"], timeoutMs: UNIX_TIMEOUT_MS };
  if (platform === "linux") return { command: "notify-send", args: ["--version"], timeoutMs: UNIX_TIMEOUT_MS };
  if (platform === "win32") return { command: POWERSHELL, args: toastProbeArgs(), timeoutMs: WINDOWS_TIMEOUT_MS };
  return undefined;
};

export const deliver = (
  runtime: Pick<Runtime, "exec">,
  cwd: AbsolutePath,
  platform: string,
  notice: Notice,
): Channel => {
  const found = notifyCommand(platform, notice);
  if (found === undefined) return "bell";
  const result = runtime.exec({ command: found.command, args: found.args, cwd, timeoutMs: found.timeoutMs });
  return result.found && result.exitCode === 0 ? "desktop" : "bell";
};

export const BELL = "\u0007";

export const quietRange = (raw: string): readonly [number, number] | undefined => {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  const start = Number(match?.[1]);
  const end = Number(match?.[2]);
  if (match === null || start > 23 || end > 23 || start === end) return undefined;
  return [start, end];
};

export const inQuietHours = (hour: number, range: readonly [number, number] | undefined): boolean => {
  if (range === undefined) return false;
  const [start, end] = range;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
};
