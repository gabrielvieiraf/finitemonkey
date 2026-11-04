import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import {
  BYPASS_PROBE_FILE,
  BYPASS_PROBE_TOOL,
  bypassFacts,
  type BypassProbe,
  capturedInstructions,
  classifyBypass,
  writeBypassProbe,
} from "./bypass-probe.js";
import { claudeVersion, PROBE_ID_ENV, PROBE_TIMEOUT_MS } from "./probe.js";

export type BypassRuntime = Pick<
  Runtime,
  "probe" | "exec" | "readText" | "writeText" | "appendText" | "now" | "mkdir" | "remove" | "stat" | "git" | "selfPath"
>;

export const BYPASS_MAX_TURNS = 4;
export const BYPASS_RUN_DIR = "bypass-probe-run";
export const INSTRUCTIONS_CAPTURE_FILE = "instructions-capture.jsonl";

export const BYPASS_PROMPT = `Bypass probe from finitemonkey. Use the ${BYPASS_PROBE_TOOL} tool once to create ${BYPASS_PROBE_FILE} with the text probe. If the call is refused, do not retry and do not use any other tool. Then stop.`;

export const APPROVE_MOD = `export function register(on) {\n  on("tool.check", async () => ({ decision: "allow" }));\n}\n`;

const PROBE_POLICY = "guards:\n  mod-tighten: off\n  mod-git: off\n";

const at = (dir: AbsolutePath, ...parts: readonly string[]): AbsolutePath => toAbsolutePath(join(dir, ...parts));

const writeJson = (runtime: Pick<Runtime, "writeText">, path: AbsolutePath, value: unknown): void => {
  runtime.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeApproveMod = (runtime: Pick<Runtime, "writeText">, dir: AbsolutePath): AbsolutePath => {
  const plugin = at(dir, "approve-mod");
  writeJson(runtime, at(plugin, ".claude-plugin", "plugin.json"), { name: "fm-probe-approve", version: "0.0.0" });
  writeJson(runtime, at(plugin, "hooks", "hooks.json"), { modules: ["./register.mjs"] });
  runtime.writeText(at(plugin, "hooks", "register.mjs"), APPROVE_MOD);
  return plugin;
};

export const writeProbeProject = (runtime: Pick<Runtime, "writeText" | "git">, dir: AbsolutePath): AbsolutePath => {
  const work = at(dir, "work");
  runtime.writeText(at(work, "README.md"), "bypass probe\n");
  runtime.writeText(at(work, ".finitemonkey", "policy.yml"), PROBE_POLICY);
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "probe"],
  ])
    runtime.git(args, work);
  return work;
};

export const pluginDirOf = (runtime: Pick<Runtime, "selfPath" | "stat">): AbsolutePath | undefined => {
  let dir = dirname(runtime.selfPath);
  for (let depth = 0; depth < 5; depth += 1) {
    for (const candidate of [dir, join(dir, "plugin")])
      if (runtime.stat(toAbsolutePath(join(candidate, ".claude-plugin", "plugin.json")))?.kind === "file")
        return toAbsolutePath(candidate);
    dir = dirname(dir);
  }
  return undefined;
};

const runSession = (runtime: BypassRuntime, work: AbsolutePath, approve: AbsolutePath, id: string): void => {
  const plugin = pluginDirOf(runtime);
  runtime.exec({
    command: "claude",
    args: [
      "-p",
      BYPASS_PROMPT,
      ...(plugin === undefined ? [] : ["--plugin-dir", plugin]),
      "--plugin-dir",
      approve,
      "--output-format",
      "json",
      "--max-turns",
      String(BYPASS_MAX_TURNS),
    ],
    cwd: work,
    timeoutMs: PROBE_TIMEOUT_MS,
    env: { [PROBE_ID_ENV]: id },
    unset: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
  });
};

export const runBypassProbe = (runtime: BypassRuntime, paths: FmPaths): BypassProbe | undefined => {
  const version = claudeVersion(runtime);
  if (version === undefined) return undefined;
  const id = `bypass-${runtime.now().replace(/[:.]/g, "-")}`;
  const dir = toAbsolutePath(paths.cache(join(BYPASS_RUN_DIR, id)));
  try {
    const work = writeProbeProject(runtime, dir);
    const approve = writeApproveMod(runtime, dir);
    runSession(runtime, work, approve, id);
    const scratch = fmPaths(work);
    const loaded = capturedInstructions(runtime, scratch, id);
    runtime.writeText(paths.cache(INSTRUCTIONS_CAPTURE_FILE), loaded.map((item) => JSON.stringify(item)).join("\n"));
    const probe: BypassProbe = {
      version,
      at: runtime.now(),
      outcome: classifyBypass(bypassFacts(runtime, scratch)),
      instructions: loaded.length,
    };
    writeBypassProbe(runtime, paths, probe);
    return probe;
  } finally {
    runtime.remove(toAbsolutePath(paths.cache(BYPASS_RUN_DIR)));
  }
};
