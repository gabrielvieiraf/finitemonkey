import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";

export interface HookCommand {
  readonly source: "plugin" | "project" | "statusline";
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface HookRun {
  readonly event: string;
  readonly source: HookCommand["source"];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly blocked: boolean;
}

export interface FakeClaudeOptions {
  readonly project: string;
  readonly pluginRoot?: string;
  readonly pluginId?: string;
  readonly sessionId?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export type Step =
  | { readonly kind: "event"; readonly event: string; readonly payload?: JsonObject }
  | { readonly kind: "interrupt"; readonly event: string; readonly payload?: JsonObject; readonly afterMs: number }
  | { readonly kind: "transcript"; readonly entry: JsonObject }
  | { readonly kind: "statusline"; readonly input: JsonObject }
  | { readonly kind: "act"; readonly run: () => void };

const readJson = (path: string): JsonObject | undefined => {
  try {
    const parsed = parseJsonObject(readFileSync(path, "utf8"));
    return parsed.ok ? parsed.value : undefined;
  } catch {
    return undefined;
  }
};

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const strings = (value: unknown): readonly string[] => list(value).filter((item) => typeof item === "string");

const commandsFor = (config: JsonObject | undefined, event: string, source: HookCommand["source"]): HookCommand[] => {
  const hooks = config?.["hooks"];
  const groups = isRecord(hooks) ? list(hooks[event]) : [];
  return groups
    .flatMap((group) => (isRecord(group) ? list(group["hooks"]) : []))
    .filter(isRecord)
    .flatMap((handler) => {
      const command = handler["command"];
      if (handler["type"] !== "command" || typeof command !== "string") return [];
      const timeout = typeof handler["timeout"] === "number" ? handler["timeout"] : 60;
      return [{ source, command, args: strings(handler["args"]), timeoutMs: timeout * 1000 }];
    });
};

const blockedBy = (exitCode: number | null, stdout: string): boolean => {
  if (exitCode === 2) return true;
  const parsed = parseJsonObject(stdout.trim() === "" ? "{}" : stdout);
  if (!parsed.ok) return false;
  const specific = parsed.value["hookSpecificOutput"];
  return parsed.value["decision"] === "block" || (isRecord(specific) && specific["permissionDecision"] === "deny");
};

export class FakeClaude {
  readonly transcriptPath: string;
  readonly runs: HookRun[] = [];
  readonly statuslines: string[] = [];
  private stopActive = false;

  constructor(private readonly options: FakeClaudeOptions) {
    this.transcriptPath = join(options.project, ".fake-claude", "transcript.jsonl");
  }

  private pluginEnabled(): boolean {
    const id = this.options.pluginId ?? "finitemonkey@finitemonkey";
    const scopes = [".claude/settings.json", ".claude/settings.local.json"].map((file) =>
      readJson(join(this.options.project, file)),
    );
    const values = scopes
      .map((settings) => settings?.["enabledPlugins"])
      .map((plugins) => (isRecord(plugins) ? plugins[id] : undefined))
      .filter((value): value is boolean => typeof value === "boolean");
    return this.options.pluginRoot !== undefined && values.at(-1) !== false;
  }

  hooksFor(event: string): readonly HookCommand[] {
    const project = commandsFor(readJson(join(this.options.project, ".claude", "settings.json")), event, "project");
    const root = this.options.pluginRoot;
    const plugin =
      root !== undefined && this.pluginEnabled()
        ? commandsFor(readJson(join(root, "hooks", "hooks.json")), event, "plugin")
        : [];
    return [...project, ...plugin];
  }

  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      CLAUDE_PROJECT_DIR: this.options.project,
      ...(this.options.pluginRoot === undefined ? {} : { CLAUDE_PLUGIN_ROOT: this.options.pluginRoot }),
      ...this.options.env,
    };
  }

  private expand(arg: string): string {
    return arg
      .replaceAll("${CLAUDE_PROJECT_DIR}", this.options.project)
      .replaceAll("${CLAUDE_PLUGIN_ROOT}", this.options.pluginRoot ?? "");
  }

  private input(event: string, payload: JsonObject): string {
    return JSON.stringify({
      session_id: this.options.sessionId ?? "fake-session",
      transcript_path: this.transcriptPath,
      cwd: this.options.project,
      hook_event_name: event,
      ...(event === "Stop" || event === "SubagentStop" ? { stop_hook_active: this.stopActive } : {}),
      ...payload,
    });
  }

  private exec(event: string, hook: HookCommand, stdin: string, interruptAfterMs?: number): Promise<HookRun> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        hook.command,
        hook.args.map((arg) => this.expand(arg)),
        {
          cwd: this.options.project,
          env: this.env(),
          stdio: ["pipe", "pipe", "pipe"],
          shell: hook.source === "statusline",
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      const limit = setTimeout(() => child.kill("SIGKILL"), hook.timeoutMs);
      const interrupt =
        interruptAfterMs === undefined ? undefined : setTimeout(() => child.kill("SIGINT"), interruptAfterMs);
      child.on("error", reject);
      child.on("close", (exitCode, signal) => {
        clearTimeout(limit);
        if (interrupt !== undefined) clearTimeout(interrupt);
        resolve({ event, source: hook.source, exitCode, signal, stdout, stderr, blocked: blockedBy(exitCode, stdout) });
      });
      if (interruptAfterMs === undefined) child.stdin.end(stdin);
      else child.stdin.write(stdin.slice(0, 1));
    });
  }

  async emit(event: string, payload: JsonObject = {}, interruptAfterMs?: number): Promise<readonly HookRun[]> {
    const runs = await Promise.all(
      this.hooksFor(event).map((hook) => this.exec(event, hook, this.input(event, payload), interruptAfterMs)),
    );
    this.runs.push(...runs);
    if (event === "Stop" || event === "SubagentStop") this.stopActive = runs.some((run) => run.blocked);
    return runs;
  }

  transcript(entry: JsonObject): void {
    mkdirSync(dirname(this.transcriptPath), { recursive: true });
    appendFileSync(this.transcriptPath, `${JSON.stringify(entry)}\n`);
  }

  async statusline(input: JsonObject): Promise<string> {
    const settings = readJson(join(this.options.project, ".claude", "settings.json"));
    const line = settings?.["statusLine"];
    const command = isRecord(line) ? line["command"] : undefined;
    if (typeof command !== "string") return "";
    const run = await this.exec(
      "statusline",
      { source: "statusline", command, args: [], timeoutMs: 10_000 },
      JSON.stringify({
        session_id: this.options.sessionId ?? "fake-session",
        transcript_path: this.transcriptPath,
        ...input,
      }),
    );
    this.statuslines.push(run.stdout);
    return run.stdout;
  }

  async play(steps: readonly Step[]): Promise<void> {
    for (const step of steps) {
      if (step.kind === "event") await this.emit(step.event, step.payload);
      else if (step.kind === "interrupt") await this.emit(step.event, step.payload, step.afterMs);
      else if (step.kind === "transcript") this.transcript(step.entry);
      else if (step.kind === "statusline") await this.statusline(step.input);
      else step.run();
    }
  }

  blocks(event: string): number {
    return this.runs.filter((run) => run.event === event && run.blocked).length;
  }
}
