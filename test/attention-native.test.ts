import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deliver, notifyCommand } from "../src/attention/notify.js";
import { decodeCommand, POWERSHELL, psString } from "../src/attention/windows.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest, ExecResult } from "../src/core/runtime.js";
import { runChecks } from "../src/doctor/run.js";
import { machine } from "./doctor-support.js";
import { execResult } from "./support.js";

const CWD = toAbsolutePath("/home/ana/project");
const NOTICE = { title: "finitemonkey", body: "Gate finished for t1: it's passed" };

const recording = (answer: ExecResult): { sent: ExecRequest[]; exec: (request: ExecRequest) => ExecResult } => {
  const sent: ExecRequest[] = [];
  return {
    sent,
    exec: (request) => {
      sent.push(request);
      return answer;
    },
  };
};

const notificationsOf = (platform: NodeJS.Platform, answer: ExecResult | undefined): string => {
  const found = runChecks(
    machine({
      platform,
      exec: (request) => (request.command === POWERSHELL || request.command === "notify-send" ? answer : undefined),
    }),
  ).find((item) => item.check === "notifications");
  return `${found?.status ?? ""} ${found?.messageKey ?? ""}`;
};

describe("native notifications on Windows", () => {
  it("builds a toast through the built-in PowerShell notification API", () => {
    const command = notifyCommand("win32", NOTICE);
    assert.equal(command?.command, POWERSHELL);
    const script = decodeCommand(command.args);
    assert.match(script, /Windows\.UI\.Notifications\.ToastNotificationManager/);
    assert.match(script, /CreateTextNode\('Gate finished for t1: it''s passed'\)/);
  });

  it("quotes text so it never leaves the PowerShell string", () => {
    assert.equal(psString("a'b’c"), "'a''b’’c'");
  });

  it("reports a desktop toast when PowerShell shows it", () => {
    const { sent, exec } = recording(execResult(0));
    assert.equal(deliver({ exec }, CWD, "win32", NOTICE), "desktop");
    assert.equal(sent[0]?.command, POWERSHELL);
  });

  it("falls back to the bell when PowerShell fails or is missing", () => {
    assert.equal(deliver(recording(execResult(1)), CWD, "win32", NOTICE), "bell");
    assert.equal(deliver(recording({ ...execResult(null), found: false }), CWD, "win32", NOTICE), "bell");
    assert.equal(deliver(recording({ ...execResult(null), timedOut: true }), CWD, "win32", NOTICE), "bell");
  });

  it("doctor reports which channel works", () => {
    assert.equal(notificationsOf("win32", execResult(0)), "ok doctor.notifications.desktop");
    assert.equal(notificationsOf("win32", execResult(1)), "ok doctor.notifications.bell");
    assert.equal(notificationsOf("linux", { ...execResult(null), found: false }), "ok doctor.notifications.bell");
    assert.equal(notificationsOf("freebsd", execResult(0)), "ok doctor.notifications.bell");
  });
});
