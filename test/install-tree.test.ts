import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { nodeLock } from "../src/core/node-fs.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { Runtime } from "../src/core/runtime.js";
import { ExitCode } from "../src/exit-codes.js";
import { CONFIG_FILE, SETTINGS_FILE, VENDOR_BIN, VENDOR_PACKAGE } from "../src/install/layout.js";
import { implicitContract } from "../src/task/implicit.js";
import { contractHash, loadImplicit } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { BUNDLE, cliJson, field, found, parseBody } from "./support.js";

const base = mkdtempSync(join(tmpdir(), "fm-tree-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const runtime: Runtime = { ...nodeRuntime(), probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };

let counter = 0;
const fresh = (files: Readonly<Record<string, string>>): AbsolutePath => {
  counter += 1;
  const root = join(base, `Área de Trabalho ${String(counter)}`, "meu projeto");
  mkdirSync(join(root, ".git"), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return toAbsolutePath(root);
};

const snapshot = (root: string): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = statSync(path);
      const key = relative(root, path);
      if (stat.isDirectory()) {
        out[`${key}/`] = "dir";
        walk(path);
      } else out[key] = `${(stat.mode & 0o777).toString(8)}:${readFileSync(path).toString("base64")}`;
    }
  };
  walk(root);
  return out;
};

const fm = (root: AbsolutePath, argv: readonly string[], version = "1.0.0") =>
  cliJson(argv, { cwd: root, runtime, env: {}, version });

const SEEDS = [
  { name: "an empty repository", files: {} },
  {
    name: "existing settings with tabs, user hooks and a .gitignore without final newline",
    files: {
      [SETTINGS_FILE]:
        '{\n\t"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo mine"}]}]},\n\t"model": "x"\n}',
      ".gitignore": "node_modules\r\ndist",
    },
  },
] as const;

describe("init then uninstall leaves the tree byte-identical", () => {
  for (const { name, files } of SEEDS) {
    it(`${name}, in a path with a space and an accent`, async () => {
      const root = fresh(files);
      const before = snapshot(root);
      assert.equal((await fm(root, ["init", "--yes"])).code, ExitCode.Ok);
      assert.notDeepEqual(snapshot(root), before);
      assert.equal((await fm(root, ["uninstall", "--yes", "--purge"])).code, ExitCode.Ok);
      assert.deepEqual(snapshot(root), before);
    });
  }

  it("the default level keeps .finitemonkey/ and removes the rest", async () => {
    const root = fresh({ ".gitignore": "x\n" });
    const before = snapshot(root);
    await fm(root, ["init", "--yes"]);
    const result = await fm(root, ["uninstall", "--yes"]);
    assert.equal(result.code, ExitCode.Ok);
    const left = Object.keys(snapshot(root)).filter((path) => !(path in before));
    assert.ok(
      left.every((path) => path.startsWith(".finitemonkey")),
      left.join(", "),
    );
    assert.ok(!left.includes(join(".finitemonkey", "lock.json")));
  });

  it("uninstall without --yes exits 4 and changes nothing; without an install it exits 3", async () => {
    const root = fresh({});
    assert.equal((await fm(root, ["uninstall", "--yes"])).code, ExitCode.NotConfigured);
    await fm(root, ["init", "--yes"]);
    const installed = snapshot(root);
    const asked = await fm(root, ["uninstall", "--purge"]);
    assert.equal(asked.code, ExitCode.NeedsPerson);
    assert.equal(field(asked.body, "next"), "finitemonkey uninstall --yes --purge");
    assert.deepEqual(snapshot(root), installed);
  });

  it("user edits made after install survive uninstall", async () => {
    const root = fresh({ [SETTINGS_FILE]: '{"model":"x"}\n' });
    await fm(root, ["init", "--yes"]);
    const path = join(root, SETTINGS_FILE);
    const edited = { ...parseBody(readFileSync(path, "utf8")), theme: "dark" };
    writeFileSync(path, JSON.stringify(edited, null, 2));
    await fm(root, ["uninstall", "--yes"]);
    assert.deepEqual(parseBody(readFileSync(path, "utf8")), { model: "x", theme: "dark" });
  });
});

describe("update", () => {
  it("re-pins the vendored CLI and keeps an edited config, showing the diff", async () => {
    const root = fresh({});
    await fm(root, ["init", "--yes"], "1.0.0");
    const config = join(root, CONFIG_FILE);
    writeFileSync(config, `${readFileSync(config, "utf8")}custom: true\n`);
    assert.equal((await fm(root, ["update", "--check"], "1.0.0")).code, ExitCode.Ok);
    const check = await fm(root, ["update", "--check"], "1.1.0");
    assert.equal(check.code, ExitCode.CheckFailed);
    assert.equal(field(check.body, "error", "code"), "install_outdated");
    const updated = await fm(root, ["update", "--yes"], "1.1.0");
    assert.equal(updated.code, ExitCode.Ok);
    assert.match(readFileSync(config, "utf8"), /custom: true/);
    assert.equal(field(parseBody(readFileSync(join(root, VENDOR_PACKAGE), "utf8")), "version"), "1.1.0");
    assert.equal(readFileSync(join(root, VENDOR_BIN), "utf8"), readFileSync(BUNDLE, "utf8"));
    const diff = field(updated.body, "data", "diff");
    assert.ok(Array.isArray(diff) && diff.some((line) => line === "+ custom: true" || line === "- custom: true"));
    assert.equal((await fm(root, ["update", "--check"], "1.1.0")).code, ExitCode.Ok);
  });

  it("refuses to run before init", async () => {
    const result = await fm(fresh({}), ["update", "--yes"]);
    assert.equal(field(result.body, "error", "code"), "not_installed");
  });
});

describe("node lock", () => {
  it("refuses a held lock and takes over a stale one", () => {
    const path = toAbsolutePath(join(base, "x.lock"));
    const first = nodeLock(path, { staleMs: 60_000, owner: "a" });
    assert.ok(first.ok);
    assert.equal(nodeLock(path, { staleMs: 60_000, owner: "b" }).ok, false);
    const old = new Date(Date.now() - 120_000);
    utimesSync(path, old, old);
    const second = nodeLock(path, { staleMs: 60_000, owner: "b" });
    assert.ok(second.ok);
    second.value();
    assert.equal(nodeLock(path, { staleMs: 60_000, owner: "c" }).ok, true);
  });
});

describe("generated hook commands survive spaces and accents", () => {
  it("an explicit --bin path stays one exec argument and the hook really runs", async () => {
    const root = fresh({});
    await fm(root, ["init", "--yes", "--bin", BUNDLE]);
    const settings = parseBody(readFileSync(join(root, SETTINGS_FILE), "utf8"));
    const groups = field(settings, "hooks", "SessionStart");
    const handlers = Array.isArray(groups) ? field(groups[0], "hooks") : undefined;
    const handler: unknown = Array.isArray(handlers) ? handlers[0] : undefined;
    assert.equal(field(handler, "command"), "node");
    const args = field(handler, "args");
    assert.ok(Array.isArray(args));
    assert.deepEqual(args, [BUNDLE, "hook", "SessionStart"]);
    const input = JSON.stringify({ hook_event_name: "SessionStart", session_id: "s", cwd: root });
    const ran = spawnSync(process.execPath, args.map(String), { cwd: root, input, encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /"continue":true/);
  });
});

describe("init trusts the project's own check commands", () => {
  it("records the implicit contract hash so the gate runs the detected commands", async () => {
    const root = fresh({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) });
    assert.equal((await fm(root, ["init", "--yes"])).code, ExitCode.Ok);
    const trust = parseBody(readFileSync(join(root, ".finitemonkey", "trust.json"), "utf8"));
    const files = {
      read: (path: string) =>
        path === "package.json" ? JSON.stringify({ scripts: { test: "node --test" } }) : undefined,
      exists: () => false,
    };
    assert.equal(field(trust, "contracts", "implicit"), contractHash(implicitContract(files)));
    assert.equal(loadImplicit(runtime, fmPaths(root), files).trusted, true);
  });
});
