import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { browserLines } from "../src/commands/init.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { createTranslator } from "../src/i18n/translate.js";
import { BROWSER_SIZE_MB, browserDirs, browserPlan } from "../src/look/browser-plan.js";
import { execResult, fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const file = (name: string) => toAbsolutePath(`${ROOT}/${name}`);
const INSTALLED = { [join("/home/test", ".cache", "ms-playwright", "chromium-1140", "INSTALLATION_COMPLETE")]: "" };

const runtimeWith = (files: Readonly<Record<string, string>>, calls: ExecRequest[]) =>
  fakeRuntime({
    files,
    exec: (request) => {
      calls.push(request);
      return execResult(0, "downloaded");
    },
  });

describe("init --look offers the browser with its size", () => {
  it("shows the download size and the command and downloads nothing without consent", () => {
    const calls: ExecRequest[] = [];
    const plan = browserPlan(runtimeWith({}, calls), ROOT, {}, false);
    assert.deepEqual(plan, {
      browser: "chromium",
      sizeMb: BROWSER_SIZE_MB,
      present: false,
      command: "npx --yes playwright install chromium",
      added: false,
    });
    assert.equal(calls.length, 0);
    const lines = browserLines(createTranslator("en"), plan, false);
    assert.match(lines[0] ?? "", /chromium is missing.*about 180 MB: npx --yes playwright install chromium/);
    assert.match(lines[1] ?? "", /nothing was downloaded/);
  });

  it("with consent it runs the project's package manager runner once", () => {
    const calls: ExecRequest[] = [];
    const plan = browserPlan(runtimeWith({ [file("pnpm-lock.yaml")]: "lockfileVersion: 9\n" }, calls), ROOT, {}, true);
    assert.equal(plan.added, true);
    assert.deepEqual(
      calls.map((call) => [call.command, ...call.args].join(" ")),
      ["pnpm exec playwright install chromium"],
    );
  });

  it("an installed Chromium is reported as present and nothing runs", () => {
    const calls: ExecRequest[] = [];
    const plan = browserPlan(runtimeWith(INSTALLED, calls), ROOT, {}, true);
    assert.equal(plan.present, true);
    assert.equal(calls.length, 0);
    assert.deepEqual(browserLines(createTranslator("en"), plan, true), [
      "browser for look: chromium is already installed",
    ]);
  });

  it("PLAYWRIGHT_BROWSERS_PATH replaces the default folders", () => {
    const runtime = fakeRuntime();
    assert.deepEqual(browserDirs(runtime, { PLAYWRIGHT_BROWSERS_PATH: "/opt/browsers" }), ["/opt/browsers"]);
    assert.equal(browserDirs(runtime, { LOCALAPPDATA: "C:/Users/ana/AppData/Local" }).length, 3);
  });
});
