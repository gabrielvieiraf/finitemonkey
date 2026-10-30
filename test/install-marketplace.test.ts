import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SETTINGS_FILE } from "../src/install/layout.js";
import { marketplaceSource } from "../src/install/marketplace.js";
import { at, repo, run } from "./install-support.js";
import type { memoryFs } from "./memory-fs.js";
import { field, parseBody } from "./support.js";

const settingsOf = (fs: ReturnType<typeof memoryFs>): unknown => parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}");

describe("marketplace source for init --marketplace", () => {
  it("a -next. prerelease points at the next branch, where the marketplace file lives", () => {
    assert.deepEqual(marketplaceSource("0.1.0-next.40"), {
      key: "finitemonkey-next",
      pluginId: "finitemonkey@finitemonkey-next",
      entry: { source: { source: "github", repo: "gabrielvieiraf/finitemonkey", ref: "next" } },
    });
  });

  it("a stable version points at the default branch", () => {
    assert.deepEqual(marketplaceSource("0.1.0"), {
      key: "finitemonkey",
      pluginId: "finitemonkey@finitemonkey",
      entry: { source: { source: "github", repo: "gabrielvieiraf/finitemonkey" } },
    });
  });

  it("init on a next version registers the next branch marketplace and uninstall takes it back", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes", "--marketplace"], "0.1.0-next.40");
    const settings = settingsOf(fs);
    assert.deepEqual(field(settings, "extraKnownMarketplaces", "finitemonkey-next"), {
      source: { source: "github", repo: "gabrielvieiraf/finitemonkey", ref: "next" },
    });
    assert.equal(field(settings, "extraKnownMarketplaces", "finitemonkey"), undefined);
    assert.equal(field(settings, "enabledPlugins", "finitemonkey@finitemonkey-next"), true);
    await run(fs, ["uninstall", "--yes"], "0.1.0-next.40");
    assert.equal(field(settingsOf(fs), "extraKnownMarketplaces"), undefined);
    assert.equal(field(settingsOf(fs), "enabledPlugins"), undefined);
  });
});
