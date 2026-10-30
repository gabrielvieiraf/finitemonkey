import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { parseJsonObject } from "../src/core/parsed.js";
import { ROOT } from "./support.js";

const PLUGIN = pathToFileURL(join(ROOT, "scripts", "release-evidence.mjs")).href;

describe("release evidence plugin", () => {
  it("labels bench/evidence.json with the version being released", () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-release-")));
    try {
      mkdirSync(join(dir, "bench"));
      writeFileSync(
        join(dir, "bench", "evidence.json"),
        `${JSON.stringify({ schema: "s", version: "1.0.0-next.1" })}\n`,
      );
      const script = [
        `const { prepare } = await import(${JSON.stringify(PLUGIN)});`,
        `prepare({ scripts: [] }, { cwd: ${JSON.stringify(dir)}, nextRelease: { version: "1.0.0-next.2" }, logger: console });`,
      ].join("\n");
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const written = parseJsonObject(readFileSync(join(dir, "bench", "evidence.json"), "utf8"));
      assert.ok(written.ok);
      assert.deepEqual(written.value, { schema: "s", version: "1.0.0-next.2" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs after the npm plugin and before the git plugin commits the files", () => {
    const config = parseJsonObject(readFileSync(join(ROOT, ".releaserc.json"), "utf8"));
    assert.ok(config.ok);
    const plugins: unknown = config.value["plugins"];
    const names = (Array.isArray(plugins) ? plugins : []).map((plugin: unknown) => {
      const name: unknown = Array.isArray(plugin) ? plugin[0] : plugin;
      return name;
    });
    const at = (name: string): number => names.indexOf(name);
    assert.ok(at("@semantic-release/npm") >= 0);
    assert.ok(at("@semantic-release/npm") < at("./scripts/release-evidence.mjs"));
    assert.ok(at("./scripts/release-evidence.mjs") < at("@semantic-release/git"));
  });
});
