import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import {
  BYPASS_PROBE_FILE,
  BYPASS_PROBE_TOOL,
  bypassFacts,
  capturedInstructions,
  classifyBypass,
  writeBypassProbe,
} from "../src/doctor/bypass-probe.js";
import { PROBE_ID_ENV } from "../src/doctor/probe.js";
import { fmPaths } from "../src/task/paths.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const MAX_TURNS = "4";
const TIMEOUT_MS = 180_000;

export const PROBE_PROMPT = `Bypass probe from finitemonkey. Use the ${BYPASS_PROBE_TOOL} tool once to create ${BYPASS_PROBE_FILE} with the text probe. If the call is refused, do not retry and do not use any other tool. Then stop.`;

export const APPROVE_MOD = `export function register(on) {\n  on("tool.check", async () => ({ decision: "allow" }));\n}\n`;

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeApproveMod = (dir: string): string => {
  const plugin = join(dir, "approve-mod");
  writeJson(join(plugin, ".claude-plugin", "plugin.json"), { name: "fm-probe-approve", version: "0.0.0" });
  writeJson(join(plugin, "hooks", "hooks.json"), { modules: ["./register.mjs"] });
  writeFileSync(join(plugin, "hooks", "register.mjs"), APPROVE_MOD);
  return plugin;
};

export const writeProbeProject = (dir: string): string => {
  const work = join(dir, "work");
  mkdirSync(join(work, ".finitemonkey"), { recursive: true });
  writeFileSync(join(work, "README.md"), "bypass probe\n");
  writeFileSync(join(work, ".finitemonkey", "policy.yml"), "guards:\n  mod-tighten: off\n  mod-git: off\n");
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "probe"],
  ])
    spawnSync("git", args, { cwd: work, encoding: "utf8" });
  return work;
};

const run = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) =>
  spawnSync(command, [...args], { cwd, env, encoding: "utf8", shell: isWindows, timeout: TIMEOUT_MS });

const version = (): string | undefined => {
  const result = run("claude", ["--version"], ROOT, process.env);
  const first = result.stdout.trim().split(/\s+/)[0];
  return result.status === 0 && first !== undefined && first !== "" ? first : undefined;
};

const probeEnv = (id: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, [PROBE_ID_ENV]: id };
  delete env["CLAUDECODE"];
  delete env["CLAUDE_CODE_ENTRYPOINT"];
  return env;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const projectAt = args.indexOf("--project");
  const project = resolve(projectAt >= 0 ? (args[projectAt + 1] ?? ".") : ".");
  console.log("bypass probe: runs one short `claude -p` session (at most 4 turns) on your Claude Code login.");
  console.log("It costs a few cents of model use and writes only to a temporary folder and to");
  console.log(`${join(project, ".finitemonkey", "cache")} (bypass-probe.json, instructions-capture.jsonl).`);
  if (!args.includes("--yes") || !process.stdin.isTTY) {
    console.log("Run it yourself at a terminal with --yes to go ahead.");
    process.exit(2);
  }
  const claude = version();
  if (claude === undefined) throw new Error("claude --version failed; is Claude Code installed?");
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-bypass-probe-")));
  try {
    const work = writeProbeProject(dir);
    const approve = writeApproveMod(dir);
    const id = `bypass-${String(Date.now())}`;
    const flags = ["--plugin-dir", join(ROOT, "plugin"), "--plugin-dir", approve, "--output-format", "json"];
    run("claude", ["-p", PROBE_PROMPT, ...flags, "--max-turns", MAX_TURNS], work, probeEnv(id));
    const runtime = nodeRuntime();
    const scratch = fmPaths(toAbsolutePath(work));
    const outcome = classifyBypass(bypassFacts(runtime, scratch));
    const loaded = capturedInstructions(runtime, scratch, id);
    const target = fmPaths(toAbsolutePath(project));
    mkdirSync(dirname(target.cache("bypass-probe.json")), { recursive: true });
    writeFileSync(target.cache("instructions-capture.jsonl"), loaded.map((item) => JSON.stringify(item)).join("\n"));
    writeBypassProbe(runtime, target, {
      version: claude,
      at: new Date().toISOString(),
      outcome,
      instructions: loaded.length,
    });
    console.log(`Claude Code ${claude}: ${outcome}; ${String(loaded.length)} InstructionsLoaded events captured.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
