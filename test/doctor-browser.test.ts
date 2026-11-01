import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkBrowserLibraries, missingLibraries, packagesFor } from "../src/doctor/browser-libs.js";
import { firing, machine } from "./doctor-support.js";
import { execResult } from "./support.js";

const CHROME = "/home/test/.cache/ms-playwright/chromium-1140/chrome-linux/chrome";

const LDD = [
  "\tlinux-vdso.so.1 (0x00007ffd)",
  "\tlibnss3.so => not found",
  "\tlibnspr4.so => not found",
  "\tlibatk-bridge-2.0.so.0 => not found",
  "\tlibgobject-2.0.so.0 => /lib/x86_64-linux-gnu/libgobject-2.0.so.0 (0x00007f)",
  "\tlibasound.so.2 => not found",
].join("\n");

const withBrowser = (ldd: string, platform: NodeJS.Platform = "linux") => ({
  platform,
  files: { [CHROME]: "binary" },
  exec: (request: { readonly command: string; readonly args: readonly string[] }) =>
    request.command === "ldd" &&
    (request.args[0] ?? "").replace(/\\/g, "/").endsWith("chromium-1140/chrome-linux/chrome")
      ? execResult(0, ldd)
      : undefined,
});

describe("doctor: browser system libraries", () => {
  it("names the missing libraries and the packages that provide them", () => {
    assert.deepEqual(missingLibraries(LDD), ["libasound.so.2", "libatk-bridge-2.0.so.0", "libnspr4.so", "libnss3.so"]);
    assert.deepEqual(packagesFor(missingLibraries(LDD)), ["libasound2", "libatk-bridge2.0-0", "libnspr4", "libnss3"]);
    const found = firing(withBrowser(LDD), "browser.libraries");
    assert.equal(found.length, 1);
    const [item] = found;
    assert.equal(item?.status, "warn");
    assert.equal(item.params?.["packages"], "libasound2 libatk-bridge2.0-0 libnspr4 libnss3");
  });

  it("stays quiet when nothing is missing, no browser is installed or the system is not Linux", () => {
    assert.deepEqual(checkBrowserLibraries(machine(withBrowser("\tlibc.so.6 => /lib/libc.so.6"))), []);
    assert.deepEqual(checkBrowserLibraries(machine({})), []);
    assert.deepEqual(checkBrowserLibraries(machine(withBrowser(LDD, "darwin"))), []);
  });

  it("an unknown library is listed by its own name", () => {
    assert.deepEqual(packagesFor(["libmystery.so.9"]), ["libmystery.so.9"]);
  });
});
