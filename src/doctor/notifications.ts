import { probeCommand } from "../attention/notify.js";
import { type Check, finding } from "./types.js";

export const checkNotifications: Check = ({ platform, runtime, root }) => {
  const probe = probeCommand(platform);
  if (probe === undefined) return [finding("notifications", "ok", "doctor.notifications.bell", { platform })];
  const result = runtime.exec({ command: probe.command, args: probe.args, cwd: root, timeoutMs: probe.timeoutMs });
  return result.found && result.exitCode === 0
    ? [finding("notifications", "ok", "doctor.notifications.desktop", { command: probe.command })]
    : [finding("notifications", "ok", "doctor.notifications.bell", { platform })];
};
