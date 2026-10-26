import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExecRequest } from "../src/core/runtime.js";
import { ExitCode } from "../src/exit-codes.js";
import { LOCK_FILE, SETTINGS_FILE } from "../src/install/layout.js";
import { isOwnStatusLine } from "../src/install/statusline.js";
import { at, repo, ROOT } from "./install-support.js";
import { cliJson, fakeRuntime, field, found, missing, parseBody } from "./support.js";

const runWith = (fs: ReturnType<typeof repo>, argv: readonly string[], version = "1.0.0", calls: ExecRequest[] = []) =>
  cliJson(argv, {
    cwd: ROOT,
    runtime: fakeRuntime({
      fs,
      tools: { claude: found("2.1.300 (Claude Code)") },
      exec: (request) => {
        calls.push(request);
        return undefined;
      },
    }),
    env: {},
    version,
  });

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as readonly unknown[]) : []);

const ownHandlers = (settings: unknown): number => {
  const hooks = field(settings, "hooks");
  if (typeof hooks !== "object" || hooks === null) return 0;
  return Object.values(hooks)
    .flatMap((groups: unknown) => listOf(groups))
    .flatMap((group) => listOf(field(group, "hooks")))
    .filter((handler) => JSON.stringify(handler).includes("finitemonkey")).length;
};

describe("install and uninstall contract for known failure patterns", () => {
  it("uninstall --dry-run changes nothing", async () => {
    const fs = repo({ ".gitignore": "dist\n" });
    await runWith(fs, ["init", "--yes"]);
    const installed = fs.files();
    const writes = fs.writes();
    const preview = await runWith(fs, ["uninstall", "--dry-run", "--purge"]);
    assert.equal(preview.code, ExitCode.Ok);
    assert.equal(field(preview.body, "data", "applied"), false);
    assert.equal(fs.writes(), writes);
    assert.deepEqual(fs.files(), installed);
  });

  it("a second init after an update leaves no orphaned lock entries or duplicate hooks", async () => {
    const fs = repo();
    await runWith(fs, ["init", "--yes"], "1.0.0");
    await runWith(fs, ["update", "--yes"], "1.1.0");
    await runWith(fs, ["init", "--yes"], "1.1.0");
    const lock = parseBody(fs.read(at(LOCK_FILE)) ?? "{}");
    const entries = field(lock, "entries");
    assert.ok(Array.isArray(entries));
    const paths = entries.map((entry: unknown) => String(field(entry, "path")));
    assert.equal(new Set(paths).size, paths.length);
    for (const path of paths) assert.ok(fs.read(at(path)) !== undefined, `lock lists ${path}, which does not exist`);
    const settings = parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}");
    const events = Object.keys(field(settings, "hooks") ?? {});
    assert.equal(ownHandlers(settings), events.length);
  });

  it("a statusline the person set is wrapped by init and comes back on uninstall, and none of ours is left behind", async () => {
    const original = `${JSON.stringify({ statusLine: { type: "command", command: "my-status" } }, null, 2)}\n`;
    const fs = repo({ [SETTINGS_FILE]: original });
    await runWith(fs, ["init", "--yes"]);
    assert.ok(isOwnStatusLine(field(parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}"), "statusLine")));
    await runWith(fs, ["uninstall", "--yes", "--purge"]);
    assert.equal(fs.read(at(SETTINGS_FILE)), original);
    const bare = repo();
    await runWith(bare, ["init", "--yes"]);
    await runWith(bare, ["uninstall", "--yes", "--purge"]);
    assert.equal(bare.read(at(SETTINGS_FILE)), undefined);
  });

  it("the final uninstall message lists what stays outside the project", async () => {
    const fs = repo();
    await runWith(fs, ["init", "--yes"]);
    const result = await runWith(fs, ["uninstall", "--yes"]);
    const outside = field(result.body, "data", "outside");
    assert.ok(Array.isArray(outside));
    const text = outside.join("\n");
    assert.match(text, /claude plugin uninstall finitemonkey@finitemonkey/);
    assert.match(text, /\.bashrc/);
    assert.match(text, /rulesets/);
    assert.match(text, /refs\/finitemonkey\//);
  });

  it("init works offline: no network tool is called and nothing is downloaded", async () => {
    const calls: ExecRequest[] = [];
    const fs = repo();
    const result = await cliJson(["init", "--yes"], {
      cwd: ROOT,
      runtime: fakeRuntime({
        fs,
        tools: { claude: found("2.1.300 (Claude Code)"), npm: missing, gh: missing, curl: missing },
        exec: (request) => {
          calls.push(request);
          return undefined;
        },
      }),
      env: {},
      version: "1.0.0",
    });
    assert.equal(result.code, ExitCode.Ok);
    assert.deepEqual(
      calls.filter((call) => /^(npm|npx|pnpm|yarn|gh|curl|wget)$/.test(call.command)),
      [],
    );
    assert.ok(fs.read(at(".finitemonkey/runtime/dist/finitemonkey.mjs")) !== undefined);
  });
});
