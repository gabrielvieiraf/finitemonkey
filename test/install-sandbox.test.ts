import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ExitCode } from "../src/exit-codes.js";
import { CONFIG_FILE, SETTINGS_FILE } from "../src/install/layout.js";
import { DEFAULT_HOSTS, SANDBOX_FILE } from "../src/install/sandbox.js";
import { at, repo, ROOT } from "./install-support.js";
import { cliJson, fakeRuntime, field, found, parseBody, stdinFrom } from "./support.js";

type Fs = ReturnType<typeof repo>;

const init = (fs: Fs, argv: readonly string[], options: { platform?: NodeJS.Platform; tty?: boolean } = {}) =>
  cliJson(["init", ...argv], {
    cwd: ROOT,
    runtime: fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } }),
    env: {},
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.tty === true ? { stdin: Object.assign(stdinFrom(""), { isTTY: true }) } : {}),
  });

const warningCodes = (body: unknown): readonly unknown[] => {
  const warnings = field(body, "data", "warnings");
  return Array.isArray(warnings) ? warnings.map((warning: unknown) => field(warning, "code")) : [];
};

describe("init --sandbox writes the person's local settings only", () => {
  it("turns the sandbox on with failIfUnavailable, hidden credentials and only the declared hosts", async () => {
    const fs = repo();
    assert.equal((await init(fs, ["--yes", "--sandbox"])).code, ExitCode.Ok);
    const sandbox = field(parseBody(fs.read(at(SANDBOX_FILE)) ?? "{}"), "sandbox");
    assert.equal(field(sandbox, "enabled"), true);
    assert.equal(field(sandbox, "failIfUnavailable"), true);
    const denyRead = field(sandbox, "filesystem", "denyRead");
    assert.ok(Array.isArray(denyRead) && denyRead.includes("~/.ssh") && denyRead.includes("~/.aws"));
    assert.ok(Array.isArray(denyRead) && denyRead.some((path) => String(path).endsWith("/.env")));
    assert.deepEqual(field(sandbox, "network", "allowedDomains"), [...DEFAULT_HOSTS]);
    assert.equal(field(parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}"), "sandbox"), undefined);
  });

  it("uses the hosts declared in config.yml", async () => {
    const fs = repo({ [CONFIG_FILE]: "sandbox:\n  hosts: [registry.npmjs.org, pypi.org]\n" });
    await init(fs, ["--yes", "--sandbox"]);
    const hosts = field(parseBody(fs.read(at(SANDBOX_FILE)) ?? "{}"), "sandbox", "network", "allowedDomains");
    assert.deepEqual(hosts, ["registry.npmjs.org", "pypi.org"]);
  });

  it("keeps the person's own local settings and sandbox, and uninstall removes exactly what was added", async () => {
    const mine = '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n';
    const fs = repo({ [SANDBOX_FILE]: mine });
    await init(fs, ["--yes", "--sandbox"]);
    assert.deepEqual(field(parseBody(fs.read(at(SANDBOX_FILE)) ?? "{}"), "permissions"), { allow: ["Bash(ls)"] });
    await cliJson(["uninstall", "--yes", "--purge"], { cwd: ROOT, runtime: fakeRuntime({ fs }), env: {} });
    assert.equal(fs.read(at(SANDBOX_FILE)), mine);
    const own = '{\n  "sandbox": { "enabled": false }\n}\n';
    const other = repo({ [SANDBOX_FILE]: own });
    await init(other, ["--yes", "--sandbox"]);
    assert.equal(other.read(at(SANDBOX_FILE)), own);
  });

  it("without the flag nothing is written to the local settings", async () => {
    const fs = repo();
    await init(fs, ["--yes"]);
    assert.equal(fs.read(at(SANDBOX_FILE)), undefined);
  });
});

describe("the sandbox offer", () => {
  it("is skipped without a TTY unless --yes was given", async () => {
    assert.ok(!warningCodes((await init(repo(), ["--dry-run"])).body).includes("sandbox_offer"));
    assert.ok(warningCodes((await init(repo(), ["--dry-run", "--yes"])).body).includes("sandbox_offer"));
    assert.ok(warningCodes((await init(repo(), ["--dry-run"], { tty: true })).body).includes("sandbox_offer"));
  });

  it("is never made on native Windows, where --sandbox is refused with a warning", async () => {
    const fs = repo();
    const offer = await init(repo(), ["--dry-run", "--yes"], { platform: "win32" });
    assert.ok(!warningCodes(offer.body).includes("sandbox_offer"));
    const refused = await init(fs, ["--yes", "--sandbox"], { platform: "win32" });
    assert.ok(warningCodes(refused.body).includes("sandbox_unsupported"));
    assert.equal(fs.read(at(SANDBOX_FILE)), undefined);
  });
});
