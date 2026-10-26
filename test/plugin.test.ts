import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isRecord } from "../src/core/parsed.js";
import { deadlineFor } from "../src/hooks/events.js";
import { INSTALLED_HOOKS } from "../src/install/hook-entries.js";
import { MARKETPLACE_NAME, PLUGIN_BIN, PLUGIN_DIR, PLUGIN_NAME, pluginHooks } from "../src/install/plugin-hooks.js";
import { field, parseBody, ROOT } from "./support.js";

const read = (...parts: readonly string[]): string => readFileSync(join(ROOT, ...parts), "utf8");
const json = (...parts: readonly string[]): unknown => parseBody(read(...parts));
const version = String(field(json("package.json"), "version"));
const pluginRoot = join(ROOT, PLUGIN_DIR);

const walk = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const RESERVED = /^(claude|anthropic|anthropics|cc-plugin)-|^(claude|anthropic|anthropics|claude-code|claude-mods)$/;

const frontmatter = (text: string): Readonly<Record<string, string>> => {
  const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  const out: Record<string, string> = {};
  let key = "";
  for (const line of head.split("\n")) {
    const match = /^([a-z_-]+):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      key = match[1];
      out[key] = match[2] === ">-" ? "" : (match[2] ?? "");
    } else if (key !== "") out[key] = `${out[key] ?? ""} ${line.trim()}`.trim();
  }
  return out;
};

describe("plugin manifest", () => {
  const manifest = json(PLUGIN_DIR, ".claude-plugin", "plugin.json");
  const market = json(".claude-plugin", "marketplace.json");

  it("plugin.json has a permanent kebab-case name that is not reserved", () => {
    const name = String(field(manifest, "name"));
    assert.equal(name, PLUGIN_NAME);
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.doesNotMatch(name, RESERVED);
    assert.equal(typeof field(manifest, "description"), "string");
    assert.equal(typeof field(manifest, "author", "name"), "string");
    assert.equal(field(manifest, "license"), "Apache-2.0");
  });

  it("the plugin version is exactly the CLI version", () => {
    assert.equal(field(manifest, "version"), version);
  });

  it("the marketplace at the repo root lists the plugin from ./plugin without a second version", () => {
    assert.equal(field(market, "name"), MARKETPLACE_NAME);
    assert.equal(typeof field(market, "owner", "name"), "string");
    const plugins = field(market, "plugins");
    assert.ok(Array.isArray(plugins) && plugins.length === 1);
    const entry: unknown = plugins[0];
    assert.equal(field(entry, "name"), PLUGIN_NAME);
    assert.equal(field(entry, "source"), `./${PLUGIN_DIR}`);
    assert.equal(field(entry, "version"), undefined);
  });

  it("hooks.json is generated from the same table the project hooks use", () => {
    assert.deepEqual(json(PLUGIN_DIR, "hooks", "hooks.json"), pluginHooks());
    const hooks = field(pluginHooks(), "hooks");
    const events = isRecord(hooks) ? Object.keys(hooks) : [];
    assert.deepEqual(
      events,
      INSTALLED_HOOKS.map(({ event }) => event),
    );
  });

  it("hooks run the bundled CLI with node, with no npx and no network", () => {
    const text = read(PLUGIN_DIR, "hooks", "hooks.json");
    assert.doesNotMatch(text, /npx|npm |@latest|https?:/);
    assert.equal(read(PLUGIN_DIR, "scripts", "finitemonkey.mjs"), read("dist", "finitemonkey.mjs"));
    const skills = walk(join(pluginRoot, "skills")).map((path) => readFileSync(path, "utf8"));
    assert.ok(skills.every((body) => !body.includes("npx")));
  });

  it("guards fail closed and every hook has a timeout", () => {
    const hooks = field(pluginHooks(), "hooks");
    for (const spec of INSTALLED_HOOKS) {
      const groups = field(hooks, spec.event);
      const handlers = Array.isArray(groups) ? field(groups[0], "hooks") : undefined;
      const handler: unknown = Array.isArray(handlers) ? handlers[0] : undefined;
      assert.equal(field(handler, "timeout"), spec.timeout, spec.event);
      assert.equal(field(handler, "onFailure"), spec.guard ? "block" : undefined, spec.event);
      assert.equal(field(handler, "command"), "node");
      assert.deepEqual(field(handler, "args"), [PLUGIN_BIN, "hook", spec.event, "--via", "plugin"]);
    }
  });

  it("gives each hook more wall time than its own internal deadline", () => {
    for (const spec of INSTALLED_HOOKS) {
      assert.ok(spec.timeout * 1000 > deadlineFor(spec.event, undefined), spec.event);
    }
  });

  it("ships what the Anthropic directory asks for and nothing it rejects", () => {
    assert.ok(read(PLUGIN_DIR, "README.md").split(/\s+/).length >= 40);
    assert.equal(read(PLUGIN_DIR, "LICENSE"), read("LICENSE"));
    assert.equal(existsSync(join(pluginRoot, "bin")), false);
    const lockfiles = walk(pluginRoot).filter((path) =>
      /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(path),
    );
    assert.deepEqual(lockfiles, []);
    assert.equal(existsSync(join(pluginRoot, "CLAUDE.md")), false);
  });
});

describe("plugin skills", () => {
  const required = ["finish", "task", "verify", "look", "write"];
  for (const name of required) {
    it(`${name} is auto-invocable with a description that fits the listing`, () => {
      const meta = frontmatter(read(PLUGIN_DIR, "skills", name, "SKILL.md"));
      assert.equal(meta["name"], name);
      assert.ok((meta["description"] ?? "").length > 40);
      assert.ok(`${meta["description"] ?? ""}${meta["when_to_use"] ?? ""}`.length < 1536);
      assert.equal(meta["disable-model-invocation"], undefined);
      assert.match(meta["description"] ?? "", /^Use (when|before|after)/);
    });
  }
});

describe("plugin version stamping", () => {
  it("stamps every pin and the manifest from package.json and leaves install ids alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-stamp-"));
    try {
      cpSync(pluginRoot, join(dir, PLUGIN_DIR), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "4.5.6" }));
      const result = spawnSync(process.execPath, [join(ROOT, "scripts", "plugin-sync.mjs"), dir], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const stamped = walk(join(dir, PLUGIN_DIR))
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      assert.match(stamped, /"version": "4\.5\.6"/);
      assert.match(stamped, /finitemonkey@finitemonkey/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
