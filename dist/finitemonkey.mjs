#!/usr/bin/env node

// src/core/brand.ts
import { isAbsolute, resolve } from "node:path";
var toAbsolutePath = (path, base) => isAbsolute(path) || !base ? resolve(path) : resolve(base, path);

// src/core/entry.ts
import { fileURLToPath } from "node:url";
var isEntryPoint = (moduleUrl, argv1, realpath, platform) => {
  if (argv1 === void 0) return false;
  const self = realpath(fileURLToPath(moduleUrl));
  const invoked = realpath(argv1);
  return platform === "win32" ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
};

// src/core/node-runtime.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/core/node-fs.ts
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";

// src/core/parsed.ts
var accept = (value) => ({ ok: true, value });
var reject = (error) => ({ ok: false, error });
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var parseJson = (text2) => {
  try {
    return accept(JSON.parse(text2));
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};
var parseJsonObject = (text2) => {
  const parsed = parseJson(text2);
  if (!parsed.ok) return parsed;
  return isRecord(parsed.value) ? accept(parsed.value) : reject("expected a JSON object");
};
var optionalString = (record2, key) => {
  const value = record2[key];
  return typeof value === "string" ? value : void 0;
};

// src/core/node-fs.ts
var NEW_FILE_MODE = 420;
var SKIPPED_DIRS = /* @__PURE__ */ new Set([".git", "node_modules"]);
var messageOf = (error) => error instanceof Error ? error.message : String(error);
var errnoOf = (error) => error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : void 0;
var attempt = (work) => {
  try {
    work();
    return accept(void 0);
  } catch (error) {
    return reject(messageOf(error));
  }
};
var nodeWriteText = (path, text2) => {
  const temp = `${path}.${String(process.pid)}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 448 });
    const fd = openSync(temp, "w", 384);
    try {
      writeSync(fd, text2);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    return accept(true);
  } catch (error) {
    rmSync(temp, { force: true });
    return reject(messageOf(error));
  }
};
var nodeStat = (path) => {
  try {
    const stats = statSync(path);
    return { kind: stats.isDirectory() ? "dir" : "file", mtimeMs: stats.mtimeMs };
  } catch {
    return void 0;
  }
};
var nodeListDir = (path) => {
  try {
    return accept(readdirSync(path).sort());
  } catch (error) {
    return reject(messageOf(error));
  }
};
var modeOf = (path) => {
  try {
    return statSync(path).mode & 511;
  } catch {
    return NEW_FILE_MODE;
  }
};
var writeAndSync = (file, content, mode) => {
  const fd = openSync(file, "wx", mode);
  try {
    writeSync(fd, content, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
var nodeWriteAtomic = (path, content) => {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  return attempt(() => {
    try {
      writeAndSync(temp, content, modeOf(path));
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  });
};
var nodeRename = (from, to) => attempt(() => {
  renameSync(from, to);
});
var nodeMkdir = (path) => attempt(() => {
  mkdirSync(path, { recursive: true });
});
var nodeRemove = (path) => attempt(() => {
  rmSync(path, { recursive: true, force: true });
});
var createLock = (path, owner, now) => {
  const fd = openSync(path, "wx", 384);
  try {
    writeSync(fd, `${JSON.stringify({ owner, pid: process.pid, at: now })}
`, null, "utf8");
  } finally {
    closeSync(fd);
  }
};
var release = (path) => () => {
  try {
    unlinkSync(path);
  } catch {
    return;
  }
};
var isStale = (path, staleMs, now) => {
  const stat = nodeStat(path);
  return stat !== void 0 && now - stat.mtimeMs > staleMs;
};
var nodeLock = (path, options) => {
  for (let round = 0; round < 2; round += 1) {
    const now = Date.now();
    try {
      createLock(path, options.owner, now);
      return accept(release(path));
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") return reject(messageOf(error));
      if (!isStale(path, options.staleMs, now)) return reject(`locked: ${path}`);
      rmSync(path, { force: true });
    }
  }
  return reject(`locked: ${path}`);
};
var walkInto = (root, dir, out) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walkInto(root, full, out);
    } else if (entry.isFile()) {
      out.push(relative(root, full).split("\\").join("/"));
    }
  }
};
var nodeWalkFiles = (root) => {
  try {
    const out = [];
    walkInto(root, root, out);
    return accept(out.sort());
  } catch (error) {
    return reject(messageOf(error));
  }
};

// src/core/node-git.ts
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
var MAX_BUFFER = 256 * 1024 * 1024;
var GIT_ENV = { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
var notFound = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
var nodeGit = (args, cwd) => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    env: GIT_ENV
  });
  const stdout = result.stdout;
  return {
    found: !notFound(result.error),
    ok: result.error === void 0 && result.status === 0,
    stdout: typeof stdout === "string" ? stdout : ""
  };
};
var nodeGitLines = (args, cwd, onLine) => new Promise((resolve2) => {
  const child = spawn("git", [...args], {
    cwd,
    windowsHide: true,
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "ignore"]
  });
  let found = true;
  child.on("error", (error) => {
    found = !notFound(error);
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", onLine);
  child.on("close", (code) => {
    resolve2({ found, ok: found && code === 0, stdout: "" });
  });
});

// src/core/node-runtime.ts
var SAFE_TOKEN = /^[A-Za-z0-9._-]+$/;
var WINDOWS_NOT_FOUND = 9009;
var errnoCode = (error) => {
  if (!(error instanceof Error) || !("code" in error)) return void 0;
  return typeof error.code === "string" ? error.code : void 0;
};
var spawnProbe = (command, args, timeout) => {
  const options = { encoding: "utf8", timeout, windowsHide: true };
  return process.platform === "win32" ? spawnSync2([command, ...args].join(" "), { ...options, shell: true }) : spawnSync2(command, [...args], options);
};
var nodeProbe = (command, args, timeoutMs) => {
  if (![command, ...args].every((token) => SAFE_TOKEN.test(token))) {
    return { found: false, ok: false, stdout: "", timedOut: false };
  }
  const result = spawnProbe(command, args, timeoutMs);
  const code = errnoCode(result.error);
  const stdout = result.stdout;
  return {
    found: code !== "ENOENT" && result.status !== WINDOWS_NOT_FOUND,
    ok: result.error === void 0 && result.status === 0,
    stdout: typeof stdout === "string" ? stdout.trim() : "",
    timedOut: code === "ETIMEDOUT"
  };
};
var nodeReadText = (path) => {
  try {
    return accept(readFileSync(path, "utf8"));
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};
var nodeRealpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
var nodeRuntime = () => ({
  nodeVersion: process.versions.node,
  readText: nodeReadText,
  probe: nodeProbe,
  startTimer: (ms, onFire) => {
    const timer = setTimeout(onFire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
  writeText: nodeWriteText,
  listDir: nodeListDir,
  walkFiles: nodeWalkFiles,
  now: () => (/* @__PURE__ */ new Date()).toISOString(),
  git: nodeGit,
  gitLines: nodeGitLines,
  stat: nodeStat,
  writeAtomic: nodeWriteAtomic,
  rename: nodeRename,
  mkdir: nodeMkdir,
  remove: nodeRemove,
  lock: nodeLock,
  selfPath: toAbsolutePath(fileURLToPath2(import.meta.url))
});

// src/doctor/system.ts
var detectOs = ({ platform, env, runtime }) => {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform !== "linux") return "other";
  if (env["WSL_DISTRO_NAME"] !== void 0 || env["WSL_INTEROP"] !== void 0) return "wsl";
  const version = runtime.readText(toAbsolutePath("/proc/version"));
  return version.ok && /microsoft/i.test(version.value) ? "wsl" : "linux";
};
var WSL_MOUNT = /^\/mnt\/[a-z](\/|$)/i;
var SYNCED = /(OneDrive|Dropbox|iCloud ?Drive|Mobile Documents|Google ?Drive)/i;
var NON_ASCII = /[^\x20-\x7e]/;
var pathTraits = (path) => ({
  spaces: path.includes(" "),
  nonAscii: NON_ASCII.test(path),
  synced: SYNCED.test(path)
});
var checkOs = (env) => {
  const os = detectOs(env);
  const findings = [
    { check: "os", status: "ok", messageKey: `doctor.os.${os}`, params: { platform: env.platform } }
  ];
  if (os === "wsl" && WSL_MOUNT.test(env.cwd)) {
    findings.push({
      check: "path.wsl_mount",
      status: "warn",
      messageKey: "doctor.path.wsl_mount",
      params: { path: env.cwd },
      fixKey: "doctor.path.fix_wsl_mount"
    });
  }
  return findings;
};
var checkPath = ({ cwd }) => {
  const traits = pathTraits(cwd);
  const chars = traits.spaces || traits.nonAscii ? {
    check: "path.chars",
    status: "warn",
    messageKey: "doctor.path.chars",
    params: { path: cwd },
    fixKey: "doctor.path.fix_chars"
  } : { check: "path.chars", status: "ok", messageKey: "doctor.path.plain", params: { path: cwd } };
  const synced = traits.synced ? [
    {
      check: "path.synced",
      status: "warn",
      messageKey: "doctor.path.synced",
      params: { path: cwd },
      fixKey: "doctor.path.fix_synced"
    }
  ] : [];
  return [chars, ...synced];
};

// src/doctor/tools.ts
var MIN_NODE_MAJOR = 20;
var MIN_GIT = { major: 2, minor: 38 };
var PROBE_TIMEOUT_MS = { git: 5e3, claude: 8e3 };
var parseGitVersion = (output) => {
  const match = /(\d+)\.(\d+)/.exec(output);
  if (match?.[1] === void 0 || match[2] === void 0) return void 0;
  return { major: Number(match[1]), minor: Number(match[2]) };
};
var isOlder = (version, min) => version.major < min.major || version.major === min.major && version.minor < min.minor;
var checkNode = ({ runtime }) => {
  const version = runtime.nodeVersion.replace(/^v/, "");
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return [
      {
        check: "node",
        status: "fail",
        messageKey: "doctor.node.old",
        params: { version, min: MIN_NODE_MAJOR },
        fixKey: "doctor.node.fix"
      }
    ];
  }
  return [{ check: "node", status: "ok", messageKey: "doctor.node.ok", params: { version } }];
};
var checkGit = ({ runtime }) => {
  const result = runtime.probe("git", ["--version"], PROBE_TIMEOUT_MS.git);
  if (!result.found || !result.ok) {
    return [{ check: "git", status: "fail", messageKey: "doctor.git.missing", fixKey: "doctor.git.fix" }];
  }
  const parsed = parseGitVersion(result.stdout);
  const version = parsed === void 0 ? result.stdout : `${String(parsed.major)}.${String(parsed.minor)}`;
  if (parsed === void 0 || isOlder(parsed, MIN_GIT)) {
    const min = `${String(MIN_GIT.major)}.${String(MIN_GIT.minor)}`;
    return [
      {
        check: "git",
        status: "warn",
        messageKey: "doctor.git.old",
        params: { version, min },
        fixKey: "doctor.git.fix_old"
      }
    ];
  }
  return [{ check: "git", status: "ok", messageKey: "doctor.git.ok", params: { version } }];
};
var checkClaude = ({ runtime }) => {
  const result = runtime.probe("claude", ["--version"], PROBE_TIMEOUT_MS.claude);
  if (result.timedOut) {
    return [
      { check: "claude", status: "warn", messageKey: "doctor.claude.timeout", fixKey: "doctor.claude.fix_timeout" }
    ];
  }
  if (!result.found || !result.ok) {
    return [{ check: "claude", status: "warn", messageKey: "doctor.claude.missing", fixKey: "doctor.claude.fix" }];
  }
  const version = /\d+\.\d+\.\d+/.exec(result.stdout)?.[0] ?? result.stdout;
  return [{ check: "claude", status: "ok", messageKey: "doctor.claude.ok", params: { version } }];
};

// src/doctor/run.ts
var DOCTOR_SCHEMA = "finitemonkey/doctor@1";
var CHECKS = [checkNode, checkGit, checkClaude, checkOs, checkPath];
var doctorEnvFrom = (ctx) => ({
  platform: ctx.platform,
  env: ctx.env,
  cwd: ctx.cwd,
  runtime: ctx.runtime
});
var runChecks = (env, checks = CHECKS) => checks.flatMap((check2) => check2(env));
var toItem = (ctx, finding) => ({
  check: finding.check,
  status: finding.status,
  detail: ctx.t(finding.messageKey, finding.params),
  ...finding.fixKey === void 0 ? {} : { fix: ctx.t(finding.fixKey, finding.params) }
});
var count = (items, status) => items.filter((item) => item.status === status).length;
var buildReport = (ctx, findings) => {
  const checks = findings.map((finding) => toItem(ctx, finding));
  return {
    schema: DOCTOR_SCHEMA,
    checks,
    summary: { ok: count(checks, "ok"), warn: count(checks, "warn"), fail: count(checks, "fail") }
  };
};

// src/exit-codes.ts
var ExitCode = {
  Ok: 0,
  CheckFailed: 1,
  Usage: 2,
  NotConfigured: 3,
  NeedsPerson: 4,
  Internal: 5
};
var EXIT_CODE_NAMES = [
  "Ok",
  "CheckFailed",
  "Usage",
  "NotConfigured",
  "NeedsPerson",
  "Internal"
];
var exitCodeDocs = {
  0: "exit.ok",
  1: "exit.check_failed",
  2: "exit.usage",
  3: "exit.not_configured",
  4: "exit.needs_person",
  5: "exit.internal"
};

// src/commands/doctor.ts
var MARK = { ok: "ok  ", warn: "warn", fail: "FAIL" };
var itemLines = (ctx, item) => [
  `[${MARK[item.status]}] ${item.check}: ${item.detail}`,
  ...item.fix !== void 0 && item.status !== "ok" ? [`       ${ctx.t("output.fix", { fix: item.fix })}`] : []
];
var doctorResult = (ctx, report) => {
  const human = [
    ctx.t("doctor.title", { version: ctx.version }),
    ...report.checks.flatMap((item) => itemLines(ctx, item)),
    ctx.t("doctor.summary", report.summary)
  ];
  const failed2 = report.checks.find((item) => item.status === "fail");
  if (failed2 === void 0) return { ok: true, exitCode: ExitCode.Ok, data: report, human };
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data: report,
    human,
    error: {
      code: "doctor_failed",
      message: ctx.t("error.doctor_failed", { count: report.summary.fail }),
      fix: failed2.fix ?? "finitemonkey doctor"
    }
  };
};
var doctorCommand = {
  path: ["doctor"],
  summaryKey: "command.doctor.summary",
  usage: "finitemonkey doctor [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(doctorResult(ctx, buildReport(ctx, runChecks(doctorEnvFrom(ctx)))))
};

// src/core/args.ts
import { parseArgs } from "node:util";

// src/core/problem.ts
var usageProblem = (code, messageKey, fix, params = {}) => ({
  code,
  messageKey,
  params,
  fix,
  exitCode: ExitCode.Usage
});
var needsPersonProblem = (messageKey, fix, params = {}) => ({
  code: "needs_confirmation",
  messageKey,
  params,
  fix,
  exitCode: ExitCode.NeedsPerson
});
var FmError = class extends Error {
  problem;
  constructor(problem2) {
    super(problem2.code);
    this.name = "FmError";
    this.problem = problem2;
  }
};

// src/core/args.ts
var GLOBAL_OPTIONS = {
  json: { type: "boolean" },
  lang: { type: "string" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" }
};
var flag = (values, name) => values[name] === true;
var looseArgs = (argv) => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: GLOBAL_OPTIONS,
    strict: false,
    allowPositionals: true
  });
  const lang = values.lang;
  return {
    positionals,
    json: flag(values, "json"),
    yes: flag(values, "yes"),
    dryRun: flag(values, "dry-run"),
    version: flag(values, "version"),
    help: flag(values, "help"),
    lang: typeof lang === "string" ? lang : void 0
  };
};
var resolveCommand = (registry, positionals) => registry.filter((spec) => spec.path.every((part, index) => positionals[index] === part)).reduce(
  (best, spec) => best === void 0 || spec.path.length > best.consumed ? { spec, consumed: spec.path.length } : best,
  void 0
);
var strictArgs = (argv, spec) => {
  const fix = `finitemonkey help ${spec.path.join(" ")}`;
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { ...GLOBAL_OPTIONS, ...spec.options },
      strict: true,
      allowPositionals: true
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return reject(usageProblem("invalid_arguments", "error.invalid_arguments", fix, { detail }));
  }
  const rest = parsed.positionals.slice(spec.path.length);
  const max = spec.maxPositionals ?? 0;
  const extra = rest[max];
  if (extra !== void 0) {
    return reject(usageProblem("unexpected_argument", "error.unexpected_argument", fix, { argument: extra }));
  }
  return accept({ values: parsed.values, positionals: rest });
};
var stringOption = (values, name) => {
  const value = values[name];
  return typeof value === "string" ? value : void 0;
};

// src/core/result.ts
var SCHEMA_VERSION = 1;
var success = (data, human = []) => ({
  ok: true,
  exitCode: ExitCode.Ok,
  data,
  human
});
var failureFrom = (t, problem2, human) => ({
  ok: false,
  exitCode: problem2.exitCode,
  error: { code: problem2.code, message: t(problem2.messageKey, problem2.params), fix: problem2.fix },
  ...problem2.data === void 0 ? {} : { data: problem2.data },
  ...human === void 0 ? {} : { human }
});
var toEnvelope = (command, result) => ({
  schemaVersion: SCHEMA_VERSION,
  ok: result.ok,
  command,
  ...result.data === void 0 ? {} : { data: result.data },
  ...result.ok ? {} : { error: result.error },
  ...result.next === void 0 ? {} : { next: result.next }
});

// src/commands/types.ts
var commandName = (spec) => spec.path.join(" ");

// src/commands/help.ts
var GLOBAL_FLAGS = [
  { flag: "--json", key: "flag.json" },
  { flag: "--lang <pt-BR|en|es>", key: "flag.lang" },
  { flag: "--yes, -y", key: "flag.yes" },
  { flag: "--dry-run", key: "flag.dry_run" },
  { flag: "--version, -v", key: "flag.version" },
  { flag: "--help, -h", key: "flag.help" }
];
var exitCodeHelp = (ctx) => EXIT_CODE_NAMES.map((name) => ({ code: ExitCode[name], name, summary: ctx.t(exitCodeDocs[ExitCode[name]]) }));
var pad = (text2, width) => text2.padEnd(Math.max(width, text2.length + 1));
var describe = (ctx, spec) => ({
  name: commandName(spec),
  usage: spec.usage,
  summary: ctx.t(spec.summaryKey),
  status: spec.status,
  options: Object.keys(spec.options ?? {}).map((name) => `--${name}`)
});
var summaryLine = (ctx, help) => help.status === "planned" ? `${help.summary} ${ctx.t("help.planned")}` : help.summary;
var overview = (ctx, registry) => {
  const commands = registry.map((spec) => describe(ctx, spec));
  const flags = GLOBAL_FLAGS.map(({ flag: flag2, key }) => ({ flag: flag2, summary: ctx.t(key) }));
  const width = Math.max(...commands.map(({ name }) => name.length)) + 2;
  const flagWidth = Math.max(...flags.map(({ flag: flag2 }) => flag2.length)) + 2;
  const exitCodes = exitCodeHelp(ctx);
  const human = [
    `finitemonkey ${ctx.version}`,
    ctx.t("help.tagline"),
    "",
    `${ctx.t("help.usage")}: finitemonkey <${ctx.t("help.command")}> [flags]`,
    "",
    `${ctx.t("help.commands")}:`,
    ...commands.map((help) => `  ${pad(help.name, width)}${summaryLine(ctx, help)}`),
    "",
    `${ctx.t("help.flags")}:`,
    ...flags.map(({ flag: flag2, summary }) => `  ${pad(flag2, flagWidth)}${summary}`),
    "",
    `${ctx.t("help.exit_codes")}:`,
    ...exitCodes.map(({ summary }) => `  ${summary}`),
    "",
    ctx.t("help.more")
  ];
  return success({ commands, flags, exitCodes }, human);
};
var helpFor = (ctx, spec) => {
  const help = describe(ctx, spec);
  const human = [
    `${ctx.t("help.usage")}: ${help.usage}`,
    "",
    summaryLine(ctx, help),
    ...help.options.length > 0 ? ["", `${ctx.t("help.options")}: ${help.options.join(", ")}`] : []
  ];
  return success({ command: help }, human);
};
var topicHelp = (ctx, registry, topic) => {
  const resolved = resolveCommand(registry, topic);
  if (resolved !== void 0) return helpFor(ctx, resolved.spec);
  const problem2 = usageProblem("unknown_command", "error.unknown_command", "finitemonkey help", {
    command: topic.join(" ")
  });
  return failureFrom(ctx.t, problem2);
};
var helpCommand = {
  path: ["help"],
  summaryKey: "command.help.summary",
  usage: "finitemonkey help [command]",
  status: "ready",
  maxPositionals: 3,
  run: (ctx, args, registry) => Promise.resolve(
    args.positionals.length === 0 ? overview(ctx, registry) : topicHelp(ctx, registry, args.positionals)
  )
};

// src/hooks/events.ts
var HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "ConfigChange",
  "Notification",
  "SessionEnd"
];
var HOOK_POLICIES = {
  SessionStart: { failClosed: false },
  UserPromptSubmit: { failClosed: true },
  PreToolUse: { failClosed: true },
  PostToolUse: { failClosed: false },
  Stop: { failClosed: true },
  SubagentStart: { failClosed: false },
  SubagentStop: { failClosed: true },
  PreCompact: { failClosed: false },
  ConfigChange: { failClosed: true },
  Notification: { failClosed: false },
  SessionEnd: { failClosed: false }
};
var squash = (value) => value.replace(/[-_\s]/g, "").toLowerCase();
var parseHookEvent = (raw) => HOOK_EVENTS.find((event) => squash(event) === squash(raw));
var DEFAULT_HOOK_DEADLINE_MS = 3e3;
var parseDeadline = (raw) => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HOOK_DEADLINE_MS;
};

// src/secrets/baseline.ts
import { join as join2 } from "node:path";
var BASELINE_FILE = ".finitemonkey/findings/baseline.json";
var BASELINE_SCHEMA = "finitemonkey/secrets-baseline@1";
var BASELINE_STATES = ["aceito", "falso-positivo"];
var EXCEPTION_MAX_DAYS = 90;
var EMPTY_BASELINE = { schema: BASELINE_SCHEMA, entries: [] };
var baselinePath = (root) => toAbsolutePath(join2(root, BASELINE_FILE));
var text = (record2, key) => {
  const value = record2[key];
  return typeof value === "string" && value !== "" ? value : void 0;
};
var stateOf = (value) => BASELINE_STATES.find((state) => state === value);
var parseEntry = (value) => {
  if (!isRecord(value)) return void 0;
  const fields = ["id", "rule", "file", "fingerprint", "owner", "reason", "acceptedAt", "expiresAt"];
  const [id, rule, file, fingerprint, owner, reason, acceptedAt, expiresAt] = fields.map((key) => text(value, key));
  const state = stateOf(value["state"]);
  const line = value["line"];
  if (id === void 0 || rule === void 0 || file === void 0 || fingerprint === void 0) return void 0;
  if (owner === void 0 || reason === void 0 || acceptedAt === void 0 || expiresAt === void 0)
    return void 0;
  if (state === void 0 || typeof line !== "number") return void 0;
  return { id, rule, file, line, fingerprint, state, owner, reason, acceptedAt, expiresAt };
};
var parseBaseline = (raw) => {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  if (parsed.value["schema"] !== BASELINE_SCHEMA) return reject(`schema must be ${BASELINE_SCHEMA}`);
  const list2 = parsed.value["entries"];
  if (!Array.isArray(list2)) return reject("entries must be a list");
  const entries = [];
  for (const [index, item] of list2.entries()) {
    const entry = parseEntry(item);
    if (entry === void 0) return reject(`entry ${String(index)} is incomplete`);
    entries.push(entry);
  }
  return accept({ schema: BASELINE_SCHEMA, entries });
};
var loadBaseline = (runtime, root) => {
  const raw = runtime.readText(baselinePath(root));
  return raw.ok ? parseBaseline(raw.value) : accept(EMPTY_BASELINE);
};
var serializeBaseline = (baseline) => `${JSON.stringify({ schema: baseline.schema, entries: [...baseline.entries].sort((a, b) => a.id.localeCompare(b.id)) }, null, 2)}
`;
var saveBaseline = (runtime, root, baseline) => runtime.writeText(baselinePath(root), serializeBaseline(baseline));
var ratchet = (findings, baseline, now, inScope) => {
  const byId = new Map(baseline.entries.map((entry) => [entry.id, entry]));
  const seen = new Set(findings.map((finding) => finding.id));
  const entryOf3 = (finding) => byId.get(finding.id);
  return {
    fresh: findings.filter((finding) => entryOf3(finding) === void 0),
    known: findings.filter((finding) => (entryOf3(finding)?.expiresAt ?? "") >= now),
    expired: findings.filter((finding) => {
      const entry = entryOf3(finding);
      return entry !== void 0 && entry.expiresAt < now;
    }),
    fixed: inScope === void 0 ? [] : baseline.entries.filter((entry) => !seen.has(entry.id) && inScope(entry.file))
  };
};
var withoutFixed = (baseline, fixed) => {
  const gone = new Set(fixed.map((entry) => entry.id));
  return { schema: baseline.schema, entries: baseline.entries.filter((entry) => !gone.has(entry.id)) };
};
var acceptedFingerprints = (baseline, now) => new Set(baseline.entries.filter((entry) => entry.expiresAt >= now).map((entry) => entry.fingerprint));

// src/core/posix-path.ts
var toPosixPath = (path) => path.replace(/\\/g, "/");
var withoutCarriageReturn = (line) => line.endsWith("\r") ? line.slice(0, -1) : line;

// src/secrets/allowlist.ts
var PLACEHOLDER_WORDS = [
  "example",
  "placeholder",
  "your_",
  "your-",
  "yourkey",
  "yourtoken",
  "yoursecret",
  "_here",
  "-here",
  "changeme",
  "change_me",
  "change-me",
  "replace",
  "redacted",
  "dummy",
  "fake",
  "sample",
  "mock",
  "fixture",
  "test",
  "todo",
  "xxxx",
  "****",
  "....",
  "…",
  "<",
  ">",
  "${",
  "{{",
  "%s",
  "process.env",
  "secrets.",
  "env("
];
var PLACEHOLDER_VALUES = /* @__PURE__ */ new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "admin",
  "root",
  "postgres",
  "changeit",
  "user",
  "pass"
]);
var ENV_REFERENCE = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;
var LOCKFILES = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|go\.sum|Cargo\.lock|poetry\.lock|uv\.lock|composer\.lock|Gemfile\.lock)$/;
var TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|__fixtures__|fixtures|spec|testdata|examples?)\/|\.(?:test|spec)\.[A-Za-z0-9]+$/;
var isPlaceholder = (value) => {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower) || ENV_REFERENCE.test(value)) return true;
  if (PLACEHOLDER_WORDS.some((word) => lower.includes(word))) return true;
  return new Set(lower).size < 4;
};
var isTestOrLockPath = (path) => path !== void 0 && (LOCKFILES.test(toPosixPath(path)) || TEST_PATH.test(toPosixPath(path)));

// src/secrets/entropy.ts
var shannonEntropy = (text2) => {
  if (text2.length === 0) return 0;
  const counts = /* @__PURE__ */ new Map();
  for (const char of text2) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count2 of counts.values()) {
    const p = count2 / text2.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
};

// src/secrets/fingerprint.ts
import { createHash } from "node:crypto";
var sha256Hex = (text2) => createHash("sha256").update(text2).digest("hex");
var fingerprintOf = (secret) => sha256Hex(`finitemonkey:secret:${secret}`).slice(0, 16);
var ALNUM = /[A-Za-z0-9]/g;
var MIN_TAIL_LENGTH = 12;
var tailOf = (secret) => {
  const visible = (secret.match(ALNUM) ?? []).join("");
  return visible.length >= MIN_TAIL_LENGTH ? visible.slice(-4) : "****";
};

// src/secrets/lines.ts
var lineLocator = (text2) => {
  const starts = [0];
  for (let index = text2.indexOf("\n"); index !== -1; index = text2.indexOf("\n", index + 1)) starts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = low + high + 1 >> 1;
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
};

// src/secrets/rules/types.ts
var defineRule = (spec) => ({
  id: spec.id,
  summary: spec.summary,
  kind: spec.kind ?? "credential",
  severity: spec.severity ?? "high",
  keywords: spec.keywords.map((keyword) => keyword.toLowerCase()),
  pattern: new RegExp(spec.source, `gd${spec.flags ?? ""}`),
  minLength: spec.minLength ?? 8,
  minEntropy: spec.minEntropy ?? 0,
  requireDigit: spec.requireDigit ?? false,
  minRandomRun: spec.minRandomRun ?? 0,
  ignoredNames: (spec.ignoredNames ?? []).map((name) => name.toLowerCase()),
  skipTestPaths: spec.skipTestPaths ?? false,
  placeholders: spec.placeholders ?? true
});

// src/secrets/rules/providers.ts
var PROVIDER_RULES = [
  defineRule({
    id: "aws-access-token",
    summary: "AWS access key id (AKIA, ASIA, ABIA, ACCA, A3T)",
    keywords: ["akia", "asia", "abia", "acca", "a3t"],
    source: String.raw`\b(?<secret>(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b`,
    minLength: 20,
    minEntropy: 3
  }),
  defineRule({
    id: "aws-secret-access-key",
    summary: "AWS secret access key assigned to aws_secret_access_key or a similar name",
    keywords: ["secret"],
    source: String.raw`(?:aws_?)?secret_?access_?key["'\x60]?[ \t]*(?:=|:=|:|=>)[ \t]*["'\x60]?(?<secret>[A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])`,
    flags: "i",
    minLength: 40,
    minEntropy: 4
  }),
  defineRule({
    id: "github-pat",
    summary: "GitHub classic personal access token (ghp_)",
    keywords: ["ghp_"],
    source: String.raw`\b(?<secret>ghp_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "github-oauth",
    summary: "GitHub OAuth access token (gho_)",
    keywords: ["gho_"],
    source: String.raw`\b(?<secret>gho_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "github-app-token",
    summary: "GitHub App user or installation token (ghu_, ghs_)",
    keywords: ["ghu_", "ghs_"],
    source: String.raw`\b(?<secret>(?:ghu|ghs)_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "github-refresh-token",
    summary: "GitHub refresh token (ghr_)",
    keywords: ["ghr_"],
    source: String.raw`\b(?<secret>ghr_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "github-fine-grained-pat",
    summary: "GitHub fine-grained personal access token (github_pat_)",
    keywords: ["github_pat_"],
    source: String.raw`\b(?<secret>github_pat_[A-Za-z0-9_]{82})(?![A-Za-z0-9_])`,
    minEntropy: 3
  }),
  defineRule({
    id: "gitlab-pat",
    summary: "GitLab personal access token (glpat-)",
    keywords: ["glpat-"],
    source: String.raw`\b(?<secret>glpat-[A-Za-z0-9_-]{20})(?![A-Za-z0-9_-])`,
    minEntropy: 3
  }),
  defineRule({
    id: "npm-access-token",
    summary: "npm access token (npm_)",
    keywords: ["npm_"],
    source: String.raw`\b(?<secret>npm_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    flags: "i",
    minEntropy: 3
  }),
  defineRule({
    id: "slack-bot-token",
    summary: "Slack bot token (xoxb-)",
    keywords: ["xoxb-"],
    source: String.raw`\b(?<secret>xoxb-[0-9]{10,13}-[0-9]{10,13}[A-Za-z0-9-]*)`,
    minEntropy: 3
  }),
  defineRule({
    id: "slack-user-token",
    summary: "Slack user or export token (xoxp-, xoxe-)",
    keywords: ["xoxp-", "xoxe-"],
    source: String.raw`\b(?<secret>xox[pe](?:-[0-9]{10,13}){3}-[A-Za-z0-9-]{28,34})`,
    minEntropy: 3
  }),
  defineRule({
    id: "slack-app-token",
    summary: "Slack app-level token (xapp-)",
    keywords: ["xapp-"],
    source: String.raw`\b(?<secret>xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+)`,
    flags: "i",
    minEntropy: 3
  }),
  defineRule({
    id: "slack-webhook-url",
    summary: "Slack incoming webhook URL",
    keywords: ["hooks.slack.com"],
    source: String.raw`(?<secret>hooks\.slack\.com/(?:services|workflows|triggers)/[A-Za-z0-9+/]{43,56})`,
    minEntropy: 3
  }),
  defineRule({
    id: "stripe-access-token",
    summary: "Stripe live secret or restricted key (sk_live_, rk_live_)",
    keywords: ["sk_live_", "rk_live_", "sk_prod_", "rk_prod_"],
    source: String.raw`\b(?<secret>(?:sk|rk)_(?:live|prod)_[A-Za-z0-9]{20,99})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "anthropic-api-key",
    summary: "Anthropic API or admin key (sk-ant-)",
    keywords: ["sk-ant-"],
    source: String.raw`\b(?<secret>sk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{80,})`,
    minEntropy: 3.5
  }),
  defineRule({
    id: "openai-api-key",
    summary: "OpenAI API key (sk-proj-, sk-svcacct-, sk-admin- or the T3BlbkFJ marker)",
    keywords: ["t3blbkfj", "sk-proj-", "sk-svcacct-", "sk-admin-"],
    source: String.raw`\b(?<secret>sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{58,})`,
    minEntropy: 3.5
  }),
  defineRule({
    id: "gcp-api-key",
    summary: "Google API key (AIza)",
    keywords: ["aiza"],
    source: String.raw`\b(?<secret>AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])`,
    minEntropy: 3
  }),
  defineRule({
    id: "asaas-api-key",
    summary: "Asaas API key ($aact_, $aact_prod_, $aact_hmlg_) with a body; the bare prefix is a placeholder",
    keywords: ["$aact_"],
    source: String.raw`(?<secret>\$aact_(?:prod_|hmlg_)?[A-Za-z0-9+/=_:$-]{32,})`,
    minLength: 40,
    minEntropy: 3.5
  })
];

// src/secrets/rules/structural.ts
var STRUCTURAL_RULES = [
  defineRule({
    id: "private-key",
    summary: "PEM private key block (RSA, EC, DSA, OPENSSH, PGP, PKCS#8)",
    keywords: ["private key"],
    source: String.raw`-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----(?<secret>[\s\S]{64,16384}?)-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----`,
    minLength: 64,
    minEntropy: 4
  }),
  defineRule({
    id: "jwt",
    summary: "JSON Web Token with a header, a payload and a signature, checked for entropy",
    keywords: ["eyj"],
    source: String.raw`\b(?<secret>eyJ[A-Za-z0-9_-]{17,}\.eyJ[A-Za-z0-9_-]{17,}\.[A-Za-z0-9_-]{10,})`,
    minLength: 40,
    minEntropy: 3
  }),
  defineRule({
    id: "credential-in-url",
    summary: "Password or token inside a URL (scheme://user:secret@host), including git remotes",
    keywords: ["://"],
    source: String.raw`\b[a-z][a-z0-9+.-]{1,20}://[^\s:/@"'\x60]{1,64}:(?<secret>[^\s:/@"'\x60]{6,128})@[A-Za-z0-9.-]`,
    flags: "i",
    minLength: 6,
    minEntropy: 2.5
  }),
  defineRule({
    id: "default-secret-fallback",
    summary: "JavaScript secret variable with a constant fallback (process.env.X ?? 'constant')",
    kind: "practice",
    severity: "medium",
    keywords: ["process.env."],
    source: String.raw`process\.env\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD)[A-Z0-9_]*[ \t]*(?:\?\?|\|\|)[ \t]*["'\x60](?<secret>[^"'\x60\n]{4,})["'\x60]`,
    minLength: 4,
    placeholders: false,
    skipTestPaths: true
  }),
  defineRule({
    id: "default-secret-fallback-python",
    summary: "Python secret variable with a constant default (os.getenv('X', 'constant'))",
    kind: "practice",
    severity: "medium",
    keywords: ["getenv", "environ.get"],
    source: String.raw`os\.(?:getenv|environ\.get)\([ \t]*["'][A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD)[A-Za-z0-9_]*["'][ \t]*,[ \t]*["'](?<secret>[^"'\n]{4,})["']`,
    minLength: 4,
    placeholders: false,
    skipTestPaths: true
  }),
  defineRule({
    id: "generic-api-key",
    summary: "High-entropy value assigned to a name with key, secret, token or credential",
    keywords: ["key", "secret", "token", "credential"],
    source: String.raw`(?:key|secret|token|credential)s?[A-Za-z0-9_.-]{0,30}["'\x60]?[ \t]*(?:=|:=|:|=>)[ \t]*["'\x60]?(?<secret>[A-Za-z0-9_\-+/=.~$!@#%^&*]{16,200})(?![A-Za-z0-9_\-+/=.~$!@#%^&*(])`,
    flags: "i",
    minLength: 16,
    minEntropy: 3.5,
    requireDigit: true,
    minRandomRun: 12,
    ignoredNames: [
      "key",
      "keys",
      "cachekey",
      "querykey",
      "storagekey",
      "sortkey",
      "idempotencykey",
      "keyname",
      "tokentype"
    ],
    skipTestPaths: true
  }),
  defineRule({
    id: "password-assignment",
    summary: "Literal value assigned to a password name (password, passwd, pwd, senha, contraseña)",
    keywords: ["passw", "pwd", "senha", "contrase"],
    source: String.raw`(?:password|passwd|pwd|senha|contrase[ñn]a)[A-Za-z0-9_.-]{0,20}["'\x60]?[ \t]*(?:=|:=|:|=>)[ \t]*["'\x60]?(?<secret>[^\s"'\x60,;()[\]{}<>]{8,128})`,
    flags: "i",
    minLength: 8,
    minEntropy: 3,
    requireDigit: true,
    skipTestPaths: true
  })
];

// src/secrets/rules/catalog.ts
var RULES = [...PROVIDER_RULES, ...STRUCTURAL_RULES];
var CREDENTIAL_RULES = RULES.filter((rule) => rule.kind === "credential");
var ruleById = (id) => RULES.find((rule) => rule.id === id);

// src/secrets/engine.ts
var DIGIT = /[0-9]/;
var LETTER = /[A-Za-z]/;
var RUN_ENTROPY = 3;
var hasRandomRun = (secret, length) => (secret.match(new RegExp(`[A-Za-z0-9]{${String(length)},}`, "g")) ?? []).some(
  (run2) => DIGIT.test(run2) && LETTER.test(run2) && shannonEntropy(run2) >= RUN_ENTROPY
);
var accepted = (rule, secret) => secret.length >= rule.minLength && (!rule.requireDigit || DIGIT.test(secret)) && (rule.minRandomRun === 0 || hasRandomRun(secret, rule.minRandomRun)) && (!rule.placeholders || !isPlaceholder(secret)) && (rule.minEntropy === 0 || shannonEntropy(secret) >= rule.minEntropy);
var NAME_CHAR = /[A-Za-z0-9_.-]/;
var nameAround = (text2, at) => {
  let start = at;
  while (start > 0 && NAME_CHAR.test(text2.charAt(start - 1))) start -= 1;
  let end = at;
  while (end < text2.length && NAME_CHAR.test(text2.charAt(end))) end += 1;
  return text2.slice(start, end).toLowerCase();
};
var ignoredName = (rule, match) => rule.ignoredNames.length > 0 && rule.ignoredNames.includes(nameAround(match.input, match.index));
var spanOf = (rule, match) => {
  const range = match.indices?.groups?.["secret"] ?? match.indices?.[0];
  if (range === void 0 || ignoredName(rule, match)) return void 0;
  const [start, end] = range;
  const secret = match.input.slice(start, end);
  return accepted(rule, secret) ? { rule, start, end, secret } : void 0;
};
var ruleSpans = (rule, text2) => {
  const spans = [];
  for (const match of text2.matchAll(rule.pattern)) {
    const span = spanOf(rule, match);
    if (span !== void 0) spans.push(span);
  }
  return spans;
};
var overlaps = (taken, span) => taken.some((other) => span.start < other.end && other.start < span.end);
var applicable = (rules, lower, path) => {
  const testPath = isTestOrLockPath(path);
  return rules.filter(
    (rule) => !(testPath && rule.skipTestPaths) && rule.keywords.some((keyword) => lower.includes(keyword))
  );
};
var toFinding = (span, locate2) => {
  const position = locate2(span.start);
  return {
    ruleId: span.rule.id,
    severity: span.rule.severity,
    line: position.line,
    column: position.column,
    start: span.start,
    end: span.end,
    fingerprint: fingerprintOf(span.secret),
    tail: tailOf(span.secret)
  };
};
var scanText = (text2, options = {}) => {
  if (text2.length === 0) return [];
  const rules = applicable(options.rules ?? RULES, text2.toLowerCase(), options.path);
  if (rules.length === 0) return [];
  const taken = [];
  for (const rule of rules) {
    for (const span of ruleSpans(rule, text2)) if (!overlaps(taken, span)) taken.push(span);
  }
  if (taken.length === 0) return [];
  const locate2 = lineLocator(text2);
  return taken.sort((a, b) => a.start - b.start).map((span) => toFinding(span, locate2));
};

// src/secrets/incidents.ts
import { join as join3 } from "node:path";
var INCIDENTS_DIR = ".finitemonkey/incidents";
var INCIDENT_STATES = ["aberto", "exposicao-local", "rotacionado", "fechado"];
var INCIDENT_SOURCES = ["tool-output", "prompt", "history", "scan"];
var ID = /^inc-[0-9a-f]{12}$/;
var incidentId = (rule, fingerprint) => `inc-${sha256Hex(`${rule}\0${fingerprint}`).slice(0, 12)}`;
var incidentsDir = (root) => toAbsolutePath(join3(root, INCIDENTS_DIR));
var incidentFile = (root, id) => toAbsolutePath(join3(incidentsDir(root), `${id}.json`));
var pick = (options, value) => options.find((option) => option === value);
var str = (record2, key) => {
  const value = record2[key];
  return typeof value === "string" ? value : void 0;
};
var parseEvent = (value) => {
  if (!isRecord(value)) return void 0;
  const state = pick(INCIDENT_STATES, value["state"]);
  const at = str(value, "at");
  const by = str(value, "by");
  return state === void 0 || at === void 0 || by === void 0 ? void 0 : { state, at, by };
};
var parseHistory = (value) => {
  if (!Array.isArray(value)) return void 0;
  const events = value.map(parseEvent);
  return events.every((event) => event !== void 0) ? events : void 0;
};
var parseIncident = (raw) => {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  const record2 = parsed.value;
  const [id, rule, where, fingerprint, createdAt, updatedAt] = ["id", "rule", "where", "fingerprint", "createdAt", "updatedAt"].map((key) => str(record2, key));
  const state = pick(INCIDENT_STATES, record2["state"]);
  const source = pick(INCIDENT_SOURCES, record2["source"]);
  const history = parseHistory(record2["history"]);
  const firstCommit = str(record2, "firstCommit");
  if (id === void 0 || !ID.test(id) || rule === void 0 || where === void 0) return reject("incomplete");
  if (fingerprint === void 0 || createdAt === void 0 || updatedAt === void 0) return reject("incomplete");
  if (state === void 0 || source === void 0 || history === void 0) return reject("incomplete");
  const base = {
    schemaVersion: 1,
    id,
    rule,
    where,
    fingerprint,
    source,
    state,
    createdAt,
    updatedAt,
    history
  };
  return accept(firstCommit === void 0 ? base : { ...base, firstCommit });
};
var readIncident = (runtime, root, id) => {
  if (!ID.test(id)) return reject("not an incident id");
  const raw = runtime.readText(incidentFile(root, id));
  return raw.ok ? parseIncident(raw.value) : reject(raw.error);
};
var listIncidents = (runtime, root) => {
  const names = runtime.listDir(incidentsDir(root));
  if (!names.ok) return [];
  return names.value.filter((name) => name.endsWith(".json")).map((name) => readIncident(runtime, root, name.slice(0, -".json".length))).flatMap((parsed) => parsed.ok ? [parsed.value] : []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};
var saveIncident = (runtime, root, incident) => {
  const ignore = runtime.writeText(toAbsolutePath(join3(incidentsDir(root), ".gitignore")), "*\n");
  if (!ignore.ok) return ignore;
  return runtime.writeText(incidentFile(root, incident.id), `${JSON.stringify(incident, null, 2)}
`);
};
var created = (draft, now, by) => ({
  schemaVersion: 1,
  id: incidentId(draft.rule, draft.fingerprint),
  rule: draft.rule,
  where: draft.where,
  fingerprint: draft.fingerprint,
  source: draft.source,
  state: draft.state,
  createdAt: now,
  updatedAt: now,
  ...draft.firstCommit === void 0 ? {} : { firstCommit: draft.firstCommit },
  history: [{ state: draft.state, at: now, by }]
});
var recordIncident = (runtime, root, draft, by) => {
  const now = runtime.now();
  const existing = readIncident(runtime, root, incidentId(draft.rule, draft.fingerprint));
  if (existing.ok && existing.value.state !== "fechado") return existing;
  const incident = existing.ok ? {
    ...existing.value,
    state: draft.state,
    updatedAt: now,
    history: [...existing.value.history, { state: draft.state, at: now, by }]
  } : created(draft, now, by);
  const saved = saveIncident(runtime, root, incident);
  return saved.ok ? accept(incident) : reject(saved.error);
};
var ALLOWED_FROM = {
  aberto: [],
  "exposicao-local": [],
  rotacionado: ["aberto", "exposicao-local"],
  fechado: ["rotacionado"]
};
var canMove = (from, to) => ALLOWED_FROM[to].includes(from);
var moveIncident = (incident, to, now, by) => ({
  ...incident,
  state: to,
  updatedAt: now,
  history: [...incident.history, { state: to, at: now, by }]
});
var isRotated = (incident) => incident.state === "rotacionado" || incident.state === "fechado";

// src/secrets/guards/describe.ts
var MAX_LISTED = 5;
var describeFindings = (t, items) => {
  const listed2 = items.slice(0, MAX_LISTED).map(({ ruleId, where }) => t("secrets.found_item", { rule: ruleId, where }));
  const rest = items.length - listed2.length;
  return rest > 0 ? `${listed2.join("; ")}; ${t("secrets.found_more", { count: rest })}` : listed2.join("; ");
};
var lineWhere = (t, finding) => t("secrets.where.line", { line: finding.line, column: finding.column });

// src/secrets/guards/tool-input.ts
var toolName = (payload) => optionalString(payload.raw, "tool_name") ?? "";
var toolInput = (payload) => {
  const input = payload.raw["tool_input"];
  return isRecord(input) ? input : {};
};
var editTexts = (input, file) => {
  const edits = input["edits"];
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((edit) => {
    if (!isRecord(edit)) return [];
    const text2 = optionalString(edit, "new_string");
    return text2 === void 0 ? [] : [{ file, text: text2, whole: false }];
  });
};
var writtenTexts = (tool, input) => {
  const file = optionalString(input, "file_path") ?? optionalString(input, "notebook_path") ?? "";
  const single = (key, whole) => {
    const text2 = optionalString(input, key);
    return text2 === void 0 ? [] : [{ file, text: text2, whole }];
  };
  switch (tool) {
    case "Write":
      return single("content", true);
    case "Edit":
      return single("new_string", false);
    case "MultiEdit":
      return editTexts(input, file);
    case "NotebookEdit":
      return single("new_source", false);
    default:
      return [];
  }
};
var stringLeaves = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringLeaves(item, out);
  else if (isRecord(value)) for (const item of Object.values(value)) stringLeaves(item, out);
  return out;
};

// src/secrets/guards/exposure.ts
var HOOK_ACTOR = "finitemonkey";
var liveFindings = (input, texts) => {
  const baseline = loadBaseline(input.runtime, input.cwd);
  const accepted2 = acceptedFingerprints(baseline.ok ? baseline.value : EMPTY_BASELINE, input.runtime.now());
  return texts.flatMap((text2) => scanText(text2, { rules: CREDENTIAL_RULES })).filter((finding) => !accepted2.has(finding.fingerprint));
};
var record = (input, findings, draft, where) => {
  const ids = findings.map((finding) => {
    const saved = recordIncident(
      input.runtime,
      input.cwd,
      { ...draft, rule: finding.ruleId, fingerprint: finding.fingerprint, where: `${where}:${String(finding.line)}` },
      HOOK_ACTOR
    );
    return saved.ok ? saved.value.id : input.t("secrets.incident.unsaved", { detail: saved.error });
  });
  return [...new Set(ids)].join(", ");
};
var secretsUserPromptSubmit = (input) => {
  const prompt = optionalString(input.payload.raw, "prompt") ?? "";
  const findings = liveFindings(input, [prompt]);
  if (findings.length === 0) return { kind: "allow" };
  const incident = record(input, findings, { source: "prompt", state: "exposicao-local" }, "prompt");
  const items = findings.map((finding) => ({ ruleId: finding.ruleId, where: lineWhere(input.t, finding) }));
  return {
    kind: "block",
    reason: input.t("secrets.block.prompt", { found: describeFindings(input.t, items), incident })
  };
};
var secretsPostToolUse = (input) => {
  const findings = liveFindings(input, stringLeaves(input.payload.raw["tool_response"]));
  if (findings.length === 0) return { kind: "allow" };
  const tool = toolName(input.payload) || "tool";
  const incident = record(input, findings, { source: "tool-output", state: "aberto" }, `tool-output:${tool}`);
  const items = findings.map((finding) => ({ ruleId: finding.ruleId, where: lineWhere(input.t, finding) }));
  const context = input.t("secrets.post.context", { tool, found: describeFindings(input.t, items), incident });
  return {
    kind: "allow",
    output: { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }
  };
};

// src/secrets/guards/pre-tool.ts
import { relative as relative3 } from "node:path";

// src/secrets/scan.ts
import { join as join4, relative as relative2 } from "node:path";

// src/secrets/located.ts
var findingId = (ruleId, file, fingerprint) => `fm-${sha256Hex(`${ruleId}\0${file}\0${fingerprint}`).slice(0, 16)}`;
var locate = (finding, rawFile, line, commit2) => {
  const file = toPosixPath(rawFile);
  return {
    id: findingId(finding.ruleId, file, finding.fingerprint),
    ruleId: finding.ruleId,
    severity: finding.severity,
    file,
    line,
    column: finding.column,
    fingerprint: finding.fingerprint,
    tail: finding.tail,
    ...commit2 === void 0 ? {} : { commit: commit2 }
  };
};
var whereOf = (finding) => `${finding.file}:${String(finding.line)}`;

// src/secrets/diff.ts
var COMMIT = /^commit ([0-9a-f]{7,64})\b/;
var HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
var DEV_NULL = "/dev/null";
var fresh = () => ({ file: void 0, inHunk: false, next: 0, text: [], lines: [] });
var targetOf = (line) => {
  const path = line.slice(4).replace(/\t.*$/, "");
  if (path === DEV_NULL) return void 0;
  return path.startsWith("b/") ? path.slice(2) : path;
};
var collect = (chunk, commit2, found) => {
  const { file } = chunk;
  if (file === void 0 || chunk.text.length === 0) return;
  for (const finding of scanText(chunk.text.join("\n"), { path: file })) {
    const located = locate(finding, file, chunk.lines[finding.line - 1] ?? finding.line, commit2);
    found.set(located.id, located);
  }
};
var addLine = (chunk, line) => {
  const hunk = HUNK.exec(line);
  if (hunk !== null) {
    chunk.inHunk = true;
    chunk.next = Number(hunk[1]);
  } else if (!chunk.inHunk && line.startsWith("+++ ")) {
    chunk.file = targetOf(line);
  } else if (chunk.inHunk && line.startsWith("+")) {
    chunk.text.push(line.slice(1));
    chunk.lines.push(chunk.next);
    chunk.next += 1;
  } else if (chunk.inHunk && line.startsWith(" ")) {
    chunk.next += 1;
  }
};
var diffScanner = () => {
  const found = /* @__PURE__ */ new Map();
  let commit2;
  let chunk = fresh();
  const flush2 = () => {
    collect(chunk, commit2, found);
    chunk = fresh();
  };
  const header = (line) => {
    const match = COMMIT.exec(line);
    if (match !== null) {
      flush2();
      commit2 = match[1];
      return true;
    }
    if (line.startsWith("diff --git ")) {
      flush2();
      return true;
    }
    return false;
  };
  return {
    push: (raw) => {
      const line = withoutCarriageReturn(raw);
      if (!header(line)) addLine(chunk, line);
    },
    end: () => {
      flush2();
      return [...found.values()];
    }
  };
};

// src/secrets/scan.ts
var MAX_FILE_BYTES = 2 * 1024 * 1024;
var SKIPPED = /(?:^|\/)(?:\.git|node_modules|\.finitemonkey)\//;
var DIFF_FLAGS = ["-U0", "--no-color", "--no-ext-diff", "--no-renames"];
var binary = (text2) => text2.slice(0, 8e3).includes("\0");
var listed = (runtime, root, target) => {
  const git = runtime.git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", target], root);
  if (git.ok)
    return accept(
      git.stdout.split("\0").filter((name) => name !== "").map(toPosixPath)
    );
  const base = toAbsolutePath(target, root);
  const walked = runtime.walkFiles(base);
  if (!walked.ok) return walked;
  return accept(walked.value.map((name) => toPosixPath(relative2(root, join4(base, toPosixPath(name))))));
};
var scanFile = (runtime, root, file) => {
  const text2 = runtime.readText(toAbsolutePath(file, root));
  if (!text2.ok || text2.value.length > MAX_FILE_BYTES || binary(text2.value)) return [];
  return scanText(text2.value, { path: file }).map((finding) => locate(finding, file, finding.line));
};
var scanPath = (runtime, root, target) => {
  const files = listed(runtime, root, target);
  if (!files.ok) return files;
  return accept(files.value.filter((file) => !SKIPPED.test(file)).flatMap((file) => scanFile(runtime, root, file)));
};
var diffFindings = (diff) => {
  const scanner = diffScanner();
  for (const line of diff.split("\n")) scanner.push(line);
  return scanner.end().filter((finding) => !SKIPPED.test(finding.file));
};
var scanStaged = (runtime, root, includeUnstaged = false) => {
  const args = includeUnstaged ? ["diff", "HEAD", ...DIFF_FLAGS] : ["diff", "--cached", ...DIFF_FLAGS];
  const git = runtime.git(args, root);
  if (!git.ok) return reject(git.found ? "git diff failed" : "git not found");
  return accept(diffFindings(git.stdout));
};
var scanHistory = async (runtime, root) => {
  const scanner = diffScanner();
  const args = ["log", "-p", "--all", "--format=commit %H", ...DIFF_FLAGS];
  const git = await runtime.gitLines(args, root, scanner.push);
  if (!git.ok) return reject(git.found ? "git log failed" : "git not found");
  return accept(scanner.end().filter((finding) => !SKIPPED.test(finding.file)));
};

// src/secrets/guards/paths.ts
var SAFE_ENV = /^\.env\.(?:example|sample|template|dist|defaults|schema)$/i;
var ENV_FILE = /^\.env(?:\..+)?$/i;
var KEY_FILE = /\.(?:pem|key|p12|pfx)$/i;
var SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_[A-Za-z0-9_-]+)?$/;
var basename2 = (path) => path.split(/[\\/]/).pop() ?? path;
var isSensitivePath = (path) => {
  const name = basename2(path.replace(/^["']|["']$/g, ""));
  if (ENV_FILE.test(name)) return !SAFE_ENV.test(name);
  return KEY_FILE.test(name) || SSH_KEY.test(name);
};

// src/secrets/guards/bash-rules.ts
var READERS = /* @__PURE__ */ new Set([
  "cat",
  "bat",
  "batcat",
  "less",
  "more",
  "head",
  "tail",
  "nl",
  "tac",
  "strings",
  "xxd",
  "hexdump",
  "od",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "awk",
  "gawk",
  "sed",
  "cut",
  "sort",
  "uniq",
  "jq",
  "yq",
  "base64",
  "type",
  "get-content",
  "gc",
  "select-string",
  "sls",
  "diff",
  "vim",
  "vi",
  "nano",
  "view",
  "dotenv"
]);
var SECRET_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|CREDENTIAL)/i;
var PERSON_ONLY = /\b(?:finitemonkey|fm)(?:\.mjs)?\s+secrets\s+(?:accept\b|incident\s+(?:rotated|close)\b)/;
var LISTS_ENV = /* @__PURE__ */ new Set(["get-childitem", "gci", "dir", "ls"]);
var onlyFlags = (args) => args.every((arg) => arg.startsWith("-"));
var readTarget = (segment) => {
  const redirected = segment.redirectedFrom.find(isSensitivePath);
  if (redirected !== void 0) return redirected;
  const program = segment.program.toLowerCase();
  if (!READERS.has(program)) return void 0;
  if (program === "sed" && segment.args.some((arg) => arg.startsWith("-i"))) return void 0;
  return segment.args.find((arg) => !arg.startsWith("-") && isSensitivePath(arg));
};
var dumpsEnv = (segment) => {
  const program = segment.program.toLowerCase();
  if (program === "env" || program === "printenv") {
    if (onlyFlags(segment.args)) return true;
    return program === "printenv" && segment.args.some((arg) => SECRET_NAME.test(arg));
  }
  if (program === "set" || program === "export" || program === "declare") {
    return segment.args.length === 0 || segment.args.every((arg) => arg === "-p" || arg === "-x");
  }
  return LISTS_ENV.has(program) && segment.args.some((arg) => /^env:/i.test(arg));
};
var bashFindings = (command, segments) => {
  const person = PERSON_ONLY.exec(command);
  if (person !== null) return [{ kind: "person-only", command: person[0] }];
  return segments.flatMap((segment) => {
    const target = readTarget(segment);
    if (target !== void 0) return [{ kind: "read", target }];
    if (dumpsEnv(segment)) return [{ kind: "env-dump", command: [segment.program, ...segment.args].join(" ") }];
    return [];
  });
};
var GIT_GLOBALS_WITH_VALUE = /* @__PURE__ */ new Set(["-C", "-c", "--git-dir", "--work-tree"]);
var commitIntent = (segments) => {
  for (const segment of segments) {
    if (segment.program !== "git") continue;
    let index = 0;
    while (index < segment.args.length && (segment.args[index] ?? "").startsWith("-")) {
      index += GIT_GLOBALS_WITH_VALUE.has(segment.args[index] ?? "") ? 2 : 1;
    }
    if (segment.args[index] !== "commit") continue;
    const flags = segment.args.slice(index + 1);
    const all = flags.some((flag2) => flag2 === "--all" || /^-[A-Za-z]*a[A-Za-z]*$/.test(flag2));
    return { includeUnstaged: all };
  }
  return void 0;
};

// src/secrets/guards/shell.ts
var SEPARATORS = /\|\||&&|[|;&\n]/;
var TOKEN = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
var OUTPUT_REDIRECT = /^(?:\d|&)?>{1,2}\|?$/;
var OUTPUT_ATTACHED = /^(?:\d|&)?>{1,2}\|?\S/;
var WRAPPERS = /* @__PURE__ */ new Set(["sudo", "command", "exec", "time", "nice", "nohup", "builtin"]);
var tokensOf = (text2) => Array.from(text2.matchAll(TOKEN), (match) => match[1] ?? match[2] ?? match[3] ?? "");
var splitRedirects = (tokens) => {
  const words = [];
  const inputs = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (OUTPUT_REDIRECT.test(token)) {
      index += 1;
    } else if (OUTPUT_ATTACHED.test(token)) {
      continue;
    } else if (token === "<") {
      inputs.push(tokens[index + 1] ?? "");
      index += 1;
    } else if (token.startsWith("<") && !token.startsWith("<<")) {
      inputs.push(token.slice(1));
    } else {
      words.push(token);
    }
  }
  return { words, inputs };
};
var segmentOf = (text2) => {
  const { words, inputs } = splitRedirects(tokensOf(text2));
  let index = 0;
  while (index < words.length && (ASSIGNMENT.test(words[index] ?? "") || WRAPPERS.has(words[index] ?? ""))) index += 1;
  const program = words[index];
  if (program === void 0) return inputs.length > 0 ? { program: "", args: [], redirectedFrom: inputs } : void 0;
  return { program: program.split(/[\\/]/).pop() ?? program, args: words.slice(index + 1), redirectedFrom: inputs };
};
var segmentsOf = (command) => command.split(SEPARATORS).flatMap((part) => {
  const segment = segmentOf(part);
  return segment === void 0 ? [] : [segment];
});

// src/secrets/guards/pre-tool.ts
var ALLOW = { kind: "allow" };
var relativeFile = (cwd, file) => {
  if (file === "") return file;
  const rel = relative3(cwd, file).split("\\").join("/");
  return rel.startsWith("..") || rel === "" ? file : rel;
};
var writeDecision = (input, tool) => {
  const { t } = input;
  for (const written of writtenTexts(tool, toolInput(input.payload))) {
    const file = relativeFile(input.cwd, written.file);
    const found = scanText(written.text, { path: file });
    if (found.length === 0) continue;
    const items = found.map((finding) => ({
      ruleId: finding.ruleId,
      where: written.whole ? t("secrets.where.file", { file, line: finding.line, column: finding.column }) : t("secrets.where.new_text", { file, line: finding.line })
    }));
    return { kind: "block", reason: t("secrets.block.write", { file, found: describeFindings(t, items) }) };
  }
  return ALLOW;
};
var bashMessage = (t, finding) => {
  switch (finding.kind) {
    case "read":
      return t("secrets.block.read", { target: finding.target });
    case "env-dump":
      return t("secrets.block.env_dump", { command: finding.command });
    case "person-only":
      return t("secrets.block.person_only", { command: finding.command });
  }
};
var commitDecision = (input, includeUnstaged) => {
  const staged = scanStaged(input.runtime, input.cwd, includeUnstaged);
  if (!staged.ok || staged.value.length === 0) return ALLOW;
  const items = staged.value.map((finding) => ({
    ruleId: finding.ruleId,
    where: input.t("secrets.where.file", { file: finding.file, line: finding.line, column: finding.column })
  }));
  return { kind: "block", reason: input.t("secrets.block.commit", { found: describeFindings(input.t, items) }) };
};
var bashDecision = (input) => {
  const command = optionalString(toolInput(input.payload), "command") ?? "";
  if (command === "") return ALLOW;
  const segments = segmentsOf(command);
  const [first] = bashFindings(command, segments);
  if (first !== void 0) return { kind: "block", reason: bashMessage(input.t, first) };
  const found = scanText(command);
  if (found.length > 0) {
    const items = found.map((finding) => ({ ruleId: finding.ruleId, where: lineWhere(input.t, finding) }));
    return { kind: "block", reason: input.t("secrets.block.bash", { found: describeFindings(input.t, items) }) };
  }
  const commit2 = commitIntent(segments);
  return commit2 === void 0 ? ALLOW : commitDecision(input, commit2.includeUnstaged);
};
var readDecision = (input) => {
  const inputs = toolInput(input.payload);
  const target = optionalString(inputs, "file_path") ?? optionalString(inputs, "path") ?? "";
  if (target === "" || !isSensitivePath(target)) return ALLOW;
  return { kind: "block", reason: input.t("secrets.block.read", { target: relativeFile(input.cwd, target) }) };
};
var WRITERS = /* @__PURE__ */ new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
var SHELLS = /* @__PURE__ */ new Set(["Bash", "PowerShell"]);
var READS = /* @__PURE__ */ new Set(["Read", "Grep"]);
var secretsPreToolUse = (input) => {
  const tool = toolName(input.payload);
  if (WRITERS.has(tool)) return writeDecision(input, tool);
  if (SHELLS.has(tool)) return bashDecision(input);
  if (READS.has(tool)) return readDecision(input);
  return ALLOW;
};

// src/hooks/handlers.ts
var allow = () => ({ kind: "allow" });
var DEFAULT_HANDLERS = {
  PreToolUse: [secretsPreToolUse],
  UserPromptSubmit: [secretsUserPromptSubmit],
  PostToolUse: [secretsPostToolUse]
};

// src/hooks/payload.ts
var EMPTY_PAYLOAD = {
  hookEventName: void 0,
  sessionId: void 0,
  cwd: void 0,
  stopHookActive: false,
  raw: {}
};
var parseHookPayload = (event, text2, interactive) => {
  if (interactive && text2.trim() === "") return accept(EMPTY_PAYLOAD);
  const parsed = parseJsonObject(text2);
  if (!parsed.ok) return reject(`stdin: ${parsed.error}`);
  const payload = {
    hookEventName: optionalString(parsed.value, "hook_event_name"),
    sessionId: optionalString(parsed.value, "session_id"),
    cwd: optionalString(parsed.value, "cwd"),
    stopHookActive: parsed.value["stop_hook_active"] === true,
    raw: parsed.value
  };
  if (payload.hookEventName !== void 0 && payload.hookEventName !== event) {
    return reject(`payload is for ${payload.hookEventName}, not ${event}`);
  }
  return accept(payload);
};

// src/hooks/stdin.ts
var readAll = (source) => new Promise((resolve2, reject2) => {
  if (source.isTTY === true) {
    resolve2("");
    return;
  }
  const chunks = [];
  source.setEncoding?.("utf8");
  source.on("data", (chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  source.on("end", () => {
    resolve2(chunks.join(""));
  });
  source.on("error", reject2);
});
var DeadlineError = class extends Error {
  ms;
  constructor(ms) {
    super(`deadline of ${String(ms)} ms exceeded`);
    this.name = "DeadlineError";
    this.ms = ms;
  }
};
var withDeadline = (work, ms, startTimer) => new Promise((resolve2, reject2) => {
  const cancel = startTimer(ms, () => {
    reject2(new DeadlineError(ms));
  });
  work.then(
    (value) => {
      cancel();
      resolve2(value);
    },
    (error) => {
      cancel();
      reject2(error instanceof Error ? error : new Error(String(error)));
    }
  );
});

// src/hooks/runner.ts
var messageOf2 = (error) => error instanceof Error ? error.message : String(error);
var decide = async (input, handlers) => {
  let output = {};
  for (const handler of handlers[input.event] ?? [allow]) {
    const decision = await handler(input);
    if (decision.kind === "block") return decision;
    output = { ...output, ...decision.output };
  }
  return { kind: "allow", output };
};
var evaluate = async (event, options) => {
  const text2 = await readAll(options.stdin);
  const parsed = parseHookPayload(event, text2, options.stdin.isTTY === true);
  if (!parsed.ok) return { kind: "failed", payload: void 0, detail: parsed.error };
  const payload = parsed.value;
  try {
    return {
      kind: "decided",
      payload,
      decision: await decide(
        { event, payload, cwd: options.cwd, runtime: options.runtime, t: options.t },
        options.handlers
      )
    };
  } catch (error) {
    return { kind: "failed", payload, detail: messageOf2(error) };
  }
};
var ALLOW_STDOUT = `${JSON.stringify({ continue: true })}
`;
var allowed = (output) => ({
  exitCode: 0,
  stdout: `${JSON.stringify({ continue: true, ...output })}
`,
  stderr: "",
  verdict: "allow"
});
var released = (event, detail, t) => ({
  exitCode: 0,
  stdout: ALLOW_STDOUT,
  stderr: `finitemonkey: ${t("hook.stop_released", { event, detail })}
`,
  verdict: "stop_released"
});
var failed = (event, detail, t) => HOOK_POLICIES[event].failClosed ? {
  exitCode: 2,
  stdout: "",
  stderr: `finitemonkey: ${t("hook.failed_closed", { event, detail })}
`,
  verdict: "failed_closed"
} : {
  exitCode: 0,
  stdout: "",
  stderr: `finitemonkey: ${t("hook.failed_open", { event, detail })}
`,
  verdict: "failed_open"
};
var conclude = (event, evaluation, t) => {
  const stopActive = evaluation.payload?.stopHookActive === true;
  if (evaluation.kind === "failed") {
    return stopActive ? released(event, evaluation.detail, t) : failed(event, evaluation.detail, t);
  }
  const { decision } = evaluation;
  if (decision.kind === "allow") return allowed(decision.output);
  if (stopActive) return released(event, decision.reason, t);
  return { exitCode: 2, stdout: "", stderr: `finitemonkey: ${decision.reason}
`, verdict: "block" };
};
var runHook = async (event, options) => {
  try {
    return conclude(
      event,
      await withDeadline(evaluate(event, options), options.deadlineMs, options.startTimer),
      options.t
    );
  } catch (error) {
    return failed(event, messageOf2(error), options.t);
  }
};

// src/install/plugin-yield.ts
import { join as join5 } from "node:path";

// src/install/layout.ts
var STATE_DIR = ".finitemonkey";
var SETTINGS_FILE = ".claude/settings.json";
var GITIGNORE_FILE = ".gitignore";
var CONFIG_FILE = ".finitemonkey/config.yml";
var LOCK_FILE = ".finitemonkey/lock.json";
var BACKUPS_DIR = ".finitemonkey/backups";
var LOCKS_DIR = ".finitemonkey/locks";
var INSTALL_LOCK = ".finitemonkey/locks/install.lock";
var LOCAL_BIN = "node_modules/finitemonkey/dist/finitemonkey.mjs";
var LOCK_SCHEMA = "finitemonkey/lock@1";
var PLAN_SCHEMA = "finitemonkey/install-plan@1";
var GENERATED_MARKER = "finitemonkey:generated v=1";
var BLOCK_BEGIN = "# finitemonkey:begin v=1";
var BLOCK_END = "# finitemonkey:end";
var INSTALL_LOCK_STALE_MS = 5 * 60 * 1e3;
var PRESETS = ["neutral", "gabriel"];
var parsePreset = (raw) => raw === void 0 ? "neutral" : PRESETS.find((preset) => preset === raw);
var COMMITTED_STATE = ["config.yml", "tasks/", "rules.yml", "policy.yml", "findings/"];

// src/install/hook-entries.ts
var INSTALLED_HOOKS = [
  { event: "SessionStart", timeout: 30, guard: false },
  { event: "UserPromptSubmit", timeout: 10, guard: true },
  { event: "PreToolUse", timeout: 10, guard: true },
  { event: "PostToolUse", timeout: 30, guard: false },
  { event: "Stop", timeout: 120, guard: false },
  { event: "SubagentStart", timeout: 30, guard: false },
  { event: "SubagentStop", timeout: 120, guard: false },
  { event: "PreCompact", timeout: 30, guard: false },
  { event: "ConfigChange", timeout: 10, guard: true }
];
var PROJECT_BIN = `\${CLAUDE_PROJECT_DIR}/${LOCAL_BIN}`;
var isScript = (path) => /\.(c|m)?js$/i.test(path);
var execForm = (runner, event) => {
  if (runner.kind === "local") return { command: "node", args: [PROJECT_BIN, "hook", event] };
  if (isScript(runner.path)) return { command: "node", args: [runner.path, "hook", event] };
  return { command: runner.path, args: ["hook", event] };
};
var shellQuote = (value) => /^[A-Za-z0-9_./:=@%+-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
var npxCommand = (version, event, extra = []) => ["npx", "--yes", "--prefer-offline", `finitemonkey@${version}`, "hook", event, ...extra].map(shellQuote).join(" ");
var hookHandler = (runner, spec, failClosedSupported) => {
  const failure2 = spec.guard && failClosedSupported ? { onFailure: "block" } : {};
  if (runner.kind === "npx") {
    const command2 = npxCommand(runner.version, spec.event);
    return { type: "command", command: command2, timeout: spec.timeout, ...failure2 };
  }
  const { command, args } = execForm(runner, spec.event);
  return { type: "command", command, args, timeout: spec.timeout, ...failure2 };
};
var OWN_SHELL = /(^|[\s/"'])finitemonkey(@[^\s"]+|\.mjs|\.cmd|\.exe)?"?\s+hook\s/;
var OWN_SCRIPT = /finitemonkey(\.mjs|\.cmd|\.exe)?$/;
var stringsOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
var isOwnHandler = (handler) => {
  if (!isRecord(handler)) return false;
  const command = handler["command"];
  if (typeof command !== "string") return false;
  const args = stringsOf(handler["args"]);
  if (args.length === 0) return OWN_SHELL.test(`${command} `);
  const hookAt = args.indexOf("hook");
  if (hookAt < 0) return false;
  const target = hookAt === 0 ? command : args[hookAt - 1] ?? "";
  return OWN_SCRIPT.test(target);
};

// src/install/json-text.ts
var DEFAULT_STYLE = { indent: "  ", finalNewline: true };
var styleOf = (text2) => {
  const indented = /\n([ \t]+)\S/.exec(text2);
  return { indent: indented?.[1] ?? DEFAULT_STYLE.indent, finalNewline: text2.endsWith("\n") };
};
var renderJson = (value, style) => `${JSON.stringify(value, null, style.indent)}${style.finalNewline ? "\n" : ""}`;
var parseSettings = (text2) => text2 === void 0 || text2.trim() === "" ? { ok: true, value: {} } : parseJsonObject(text2);
var asList = (value) => Array.isArray(value) ? value : [];
var asRecord = (value) => isRecord(value) ? value : {};
var setKey = (record2, key, value) => {
  if (!(key in record2)) return value === void 0 ? record2 : { ...record2, [key]: value };
  return Object.fromEntries(
    Object.entries(record2).flatMap(([name, current]) => {
      if (name !== key) return [[name, current]];
      return value === void 0 ? [] : [[name, value]];
    })
  );
};

// src/install/settings-merge.ts
var SETTINGS_SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json";
var ATTRIBUTION_OFF = { commit: "", pr: "", sessionUrl: false };
var MARKETPLACE_ENTRY = { source: { source: "github", repo: "gabrielvieiraf/finitemonkey" } };
var MARKETPLACE_KEY = "finitemonkey";
var PLUGIN_ID = "finitemonkey@finitemonkey";
var withEntry = (settings, key, name, value) => {
  const inner = setKey(asRecord(settings[key]), name, value);
  return setKey(settings, key, Object.keys(inner).length === 0 ? void 0 : inner);
};
var hasEntry = (settings, key, name) => name in asRecord(settings[key]);
var replaceInGroup = (group, isOwn, take) => {
  if (!isRecord(group)) return group;
  const handlers = asList(group["hooks"]).flatMap((handler) => {
    if (!isOwn(handler)) return [handler];
    const replacement = take();
    return replacement === void 0 ? [] : [replacement];
  });
  return handlers.length === 0 ? void 0 : { ...group, hooks: handlers };
};
var mergeEvent = (groups, isOwn, wanted) => {
  let pending = wanted;
  const take = () => {
    const next = pending;
    pending = void 0;
    return next;
  };
  const kept = groups.map((group) => replaceInGroup(group, isOwn, take)).filter((group) => group !== void 0);
  return pending === void 0 ? kept : [...kept, { hooks: [pending] }];
};
var mergeHooks = (hooks, isOwn, wanted) => {
  const events = [.../* @__PURE__ */ new Set([...Object.keys(hooks), ...Object.keys(wanted)])];
  const entries = events.flatMap((event) => {
    const groups = hooks[event];
    if (groups !== void 0 && !Array.isArray(groups)) return [[event, groups]];
    const merged = mergeEvent(asList(groups), isOwn, wanted[event]);
    return merged.length === 0 ? [] : [[event, merged]];
  });
  return Object.fromEntries(entries);
};
var withHooks = (settings, hooks) => {
  return setKey(settings, "hooks", Object.keys(hooks).length === 0 ? void 0 : hooks);
};
var withPermissions = (settings, deny) => {
  const permissions = asRecord(settings["permissions"]);
  const next = setKey(permissions, "deny", deny.length === 0 ? void 0 : deny);
  return setKey(settings, "permissions", Object.keys(next).length === 0 ? void 0 : next);
};
var ownHookMatcher = (recorded) => (handler) => isOwnHandler(handler) || recorded.some((own) => JSON.stringify(own) === JSON.stringify(handler));
var mergeSettings = (current, wanted, recorded) => {
  const schema = Object.keys(current).length === 0;
  const base = schema ? { $schema: SETTINGS_SCHEMA_URL } : current;
  const hooks = mergeHooks(asRecord(base["hooks"]), ownHookMatcher(recorded), wanted.hooks);
  const existingDeny = asList(asRecord(base["permissions"])["deny"]);
  const deny = wanted.deny.filter((rule) => !existingDeny.includes(rule));
  const attribution = wanted.attributionOff && !("attribution" in base);
  const marketplace = wanted.marketplace && !hasEntry(base, "extraKnownMarketplaces", MARKETPLACE_KEY);
  const plugin = wanted.marketplace && !hasEntry(base, "enabledPlugins", PLUGIN_ID);
  let settings = withPermissions(withHooks(base, hooks), [...existingDeny, ...deny]);
  if (attribution) settings = { ...settings, attribution: ATTRIBUTION_OFF };
  if (marketplace) settings = withEntry(settings, "extraKnownMarketplaces", MARKETPLACE_KEY, MARKETPLACE_ENTRY);
  if (plugin) settings = withEntry(settings, "enabledPlugins", PLUGIN_ID, true);
  return { settings, added: { schema, deny, attribution, marketplace, plugin } };
};
var sameAttribution = (value) => JSON.stringify(value) === JSON.stringify(ATTRIBUTION_OFF);
var unmergeSettings = (current, added, recorded) => {
  const hooks = mergeHooks(asRecord(current["hooks"]), ownHookMatcher(recorded), {});
  const deny = asList(asRecord(current["permissions"])["deny"]).filter(
    (rule) => typeof rule !== "string" || !added.deny.includes(rule)
  );
  let settings = withPermissions(withHooks(current, hooks), deny);
  if (added.attribution && sameAttribution(settings["attribution"])) {
    settings = setKey(settings, "attribution", void 0);
  }
  if (added.marketplace) settings = withEntry(settings, "extraKnownMarketplaces", MARKETPLACE_KEY, void 0);
  if (added.plugin) settings = withEntry(settings, "enabledPlugins", PLUGIN_ID, void 0);
  if (added.schema && Object.keys(settings).length === 1 && settings["$schema"] === SETTINGS_SCHEMA_URL) return {};
  return settings;
};
var ownHandlersIn = (settings) => Object.values(asRecord(settings["hooks"])).flatMap((groups) => asList(groups)).flatMap((group) => asList(asRecord(group)["hooks"])).filter(isOwnHandler).length;

// src/install/plugin-yield.ts
var PLUGIN_VIA = "plugin";
var YIELD_STDOUT = `${JSON.stringify({ continue: true })}
`;
var projectOwnsHooks = (ctx) => {
  const root = ctx.env["CLAUDE_PROJECT_DIR"] ?? ctx.cwd;
  const text2 = ctx.runtime.readText(toAbsolutePath(join5(root, ...SETTINGS_FILE.split("/"))));
  if (!text2.ok) return false;
  const parsed = parseJsonObject(text2.value);
  return parsed.ok && ownHandlersIn(parsed.value) > 0;
};

// src/commands/hook.ts
var hookCommand = {
  path: ["hook"],
  summaryKey: "command.hook.summary",
  usage: `finitemonkey hook <${HOOK_EVENTS.join("|")}>`,
  status: "ready",
  maxPositionals: 1,
  options: { via: { type: "string" } },
  run: async (ctx, args) => {
    const raw = args.positionals[0] ?? "";
    const event = parseHookEvent(raw);
    if (event === void 0) {
      const params = { event: raw, events: HOOK_EVENTS.join(", ") };
      return failureFrom(
        ctx.t,
        usageProblem("unknown_hook_event", "error.unknown_hook_event", "finitemonkey help hook", params)
      );
    }
    if (stringOption(args.values, "via") === PLUGIN_VIA && projectOwnsHooks(ctx)) {
      return { ok: true, exitCode: 0, data: { event, verdict: "allow" }, raw: { stdout: YIELD_STDOUT, stderr: "" } };
    }
    const outcome = await runHook(event, {
      stdin: ctx.io.stdin,
      deadlineMs: parseDeadline(ctx.env["FINITEMONKEY_HOOK_DEADLINE_MS"]),
      handlers: DEFAULT_HANDLERS,
      cwd: ctx.cwd,
      t: ctx.t,
      startTimer: ctx.runtime.startTimer,
      runtime: ctx.runtime
    });
    const data = { event, verdict: outcome.verdict };
    const output = { stdout: outcome.stdout, stderr: outcome.stderr };
    if (outcome.exitCode === 0) return { ok: true, exitCode: 0, data, raw: output };
    const message = outcome.stderr.trim();
    return {
      ok: false,
      exitCode: 2,
      data,
      raw: output,
      error: { code: "hook_blocked", message, fix: "finitemonkey doctor" }
    };
  }
};

// src/commands/i18n-check.ts
import { join as join6 } from "node:path";

// src/i18n/en.json
var en_default = {
  "command.init.summary": "Set up Finite Monkey in this project",
  "command.doctor.summary": "Check the environment and say how to fix each problem",
  "command.update.summary": "Update the files Finite Monkey generated",
  "command.uninstall.summary": "Remove Finite Monkey from this project",
  "command.i18n_check.summary": "Check that the pt-BR, en and es catalogs match",
  "command.hook.summary": "Answer a Claude Code hook event (reads JSON on stdin)",
  "command.version.summary": "Print the version",
  "command.help.summary": "Show commands and flags",
  "help.tagline": "Infinite monkeys not required.",
  "help.usage": "Usage",
  "help.command": "command",
  "help.commands": "Commands",
  "help.flags": "Flags",
  "help.options": "Options",
  "help.planned": "(not available yet)",
  "help.more": "Run `finitemonkey help <command>` for details. Add --json for machine-readable output.",
  "flag.json": "Print one JSON object (schemaVersion 1) instead of text",
  "flag.lang": "Language for messages",
  "flag.yes": "Answer yes to confirmations",
  "flag.dry_run": "Show what would change without changing anything",
  "flag.version": "Print the version",
  "flag.help": "Show help",
  "output.error": "error: {message}",
  "output.fix": "fix: {fix}",
  "output.next": "next: {next}",
  "error.internal": "Finite Monkey failed unexpectedly: {detail}",
  "error.invalid_arguments": "Invalid arguments: {detail}",
  "error.unexpected_argument": 'Unexpected argument "{argument}"',
  "error.unknown_command": 'Unknown command "{command}"',
  "error.unknown_command_suggest": 'Unknown command "{command}". Did you mean "{suggestion}"?',
  "error.not_implemented": '"{command}" is not available in this version yet',
  "error.invalid_lang": 'Unsupported language "{lang}". Use one of: {languages}',
  "error.i18n_catalog_unreadable": "Could not read catalog {file}: {detail}",
  "error.i18n_mismatch": "{count} catalog problem(s) found",
  "error.doctor_failed": "{count} check(s) failed",
  "error.unknown_hook_event": 'Unknown hook event "{event}". Use one of: {events}',
  "i18n.summary": "Languages: {languages}. Keys: {keys}.",
  "i18n.ok": "All catalogs match.",
  "i18n.fix": "Edit the catalogs in {file} so every language has the same keys and placeholders",
  "i18n.problem.missing": "missing key",
  "i18n.problem.extra": "key not in en.json",
  "i18n.problem.placeholder": "placeholders differ (expected: {expected}; found: {actual})",
  "i18n.problem.empty": "empty text",
  "i18n.problem.not_string": "value is not text",
  "doctor.title": "finitemonkey doctor ({version})",
  "doctor.summary": "{ok} ok, {warn} warning(s), {fail} failure(s)",
  "doctor.node.ok": "Node.js {version}",
  "doctor.node.old": "Node.js {version} is older than the minimum {min}",
  "doctor.node.fix": "Install Node.js 20 or newer from https://nodejs.org",
  "doctor.git.ok": "git {version}",
  "doctor.git.missing": "git was not found",
  "doctor.git.fix": "Install git from https://git-scm.com/downloads",
  "doctor.git.old": "git {version} is older than {min}; some commands will need a newer git",
  "doctor.git.fix_old": "Update git to {min} or newer",
  "doctor.claude.ok": "Claude Code {version}",
  "doctor.claude.missing": "Claude Code was not found; the CLI works without it, the hooks need it",
  "doctor.claude.fix": "Install Claude Code: npm install -g @anthropic-ai/claude-code",
  "doctor.claude.timeout": "`claude --version` did not answer in time",
  "doctor.claude.fix_timeout": "Run `claude --version` by hand and check that it answers",
  "doctor.os.linux": "Linux",
  "doctor.os.wsl": "Linux on WSL",
  "doctor.os.macos": "macOS",
  "doctor.os.windows": "Windows (native)",
  "doctor.os.other": "Unrecognized system ({platform})",
  "doctor.path.plain": "Project path has no spaces or accents",
  "doctor.path.chars": "Project path has spaces or accents: {path}",
  "doctor.path.fix_chars": "Finite Monkey handles this path; if another tool fails here, move the project to a path without spaces or accents",
  "doctor.path.synced": "Project is inside a synced folder (OneDrive, Dropbox, iCloud or Google Drive): {path}",
  "doctor.path.fix_synced": "Move the project out of the synced folder to avoid sync conflicts and slow git",
  "doctor.path.wsl_mount": "Project is on a Windows drive mounted in WSL: {path}",
  "doctor.path.fix_wsl_mount": "Move the project into the Linux home (for example ~/projects) for faster git and correct permissions",
  "hook.failed_closed": "the {event} hook could not run ({detail}), so it blocked to stay safe. Run `finitemonkey doctor`",
  "hook.failed_open": "the {event} hook could not run ({detail}); continuing without it. Run `finitemonkey doctor`",
  "exit.ok": "0 ok: the command did what it was asked",
  "exit.check_failed": "1 check failed: the command ran and found a problem",
  "exit.usage": "2 usage error: unknown command, unknown flag, bad value or command not available yet",
  "exit.not_configured": "3 not configured: setup or a prerequisite (node, git, files, permissions) is missing",
  "exit.needs_person": "4 needs a person: a decision or approval is required before going on",
  "exit.internal": "5 internal error: Finite Monkey itself failed; please report it",
  "help.exit_codes": "Exit codes",
  "hook.stop_released": "the {event} hook would block again ({detail}), but Claude Code is already continuing from a stop hook, so it lets the session stop. Run `finitemonkey doctor`",
  "error.needs_confirmation": '"{command}" needs your decision before it changes anything: {question}',
  "secrets.command.scan": "Find secrets in files, the staged changes or the git history (local only)",
  "secrets.command.accept": "Accept one finding into the baseline, with a reason and an expiry (the person only)",
  "secrets.command.incident": "List secret incidents, mark them rotated or closed, and show the history purge steps",
  "secrets.found_item": "{rule} at {where}",
  "secrets.found_more": "and {count} more",
  "secrets.where.line": "line {line}, column {column}",
  "secrets.where.file": "{file}:{line}:{column}",
  "secrets.where.new_text": "{file} (line {line} of the new text)",
  "secrets.block.write": "blocked: the new text for {file} has a credential ({found}). Nothing was written. Keep the value in .env (outside git) and read it by its variable name. If the key is real, treat it as exposed and rotate it.",
  "secrets.block.bash": "blocked: this command has a credential ({found}) and did not run. Read the value from an environment variable instead of writing it in the command. If the key is real, treat it as exposed and rotate it.",
  "secrets.block.commit": "blocked: the staged changes have a credential ({found}), so the commit did not run. Remove it from the staged files, keep it in .env (outside git) and rotate it if it is real.",
  "secrets.block.read": "blocked: {target} holds secrets, and reading it would put their values in the conversation. Ask the person for the variable names, or read .env.example.",
  "secrets.block.env_dump": 'blocked: `{command}` prints every environment variable, secrets included. Print only the variable you need by name, or check that it exists with `test -n "$NAME"`.',
  "secrets.block.person_only": "blocked: `{command}` is a decision for the person, not the model. Ask the person to run it in their own terminal.",
  "secrets.block.prompt": "your message was not sent to the model: it has a credential ({found}). If this key was pasted anywhere else, treat it as exposed and rotate it. To use it, put it in .env and tell me only the variable name. Never paste keys into the chat. Incident: {incident}.",
  "secrets.post.context": "Finite Monkey: the {tool} output contained a credential ({found}). Incident {incident} is open; rotating the key is the person's decision. Finite Monkey output never repeats the value.",
  "secrets.incident.unsaved": "not recorded ({detail})",
  "secrets.scan.title": "Secrets scan ({mode}): {total} found, {new} new, {known} known, {expired} expired, {fixed} fixed",
  "secrets.scan.item": "  [{status}] {rule} {where} {mask}  id {id}",
  "secrets.scan.clean": "No secrets found. The monkey keeps its bananas to itself.",
  "secrets.accept.done": "Accepted {id} ({rule} at {where}) as {state} until {expires}, by {owner}.",
  "secrets.action.accept": "accept a finding",
  "secrets.action.rotated": "mark an incident as rotated",
  "secrets.action.close": "close an incident",
  "secrets.incident.title": "{count} incident(s)",
  "secrets.incident.item": "  {id}  {state}  {rule}  {where}  since {created}",
  "secrets.incident.none": "No secret incidents.",
  "secrets.incident.marked": "Incident {id} is now {state}.",
  "secrets.purge.title": "History purge for {id} ({where}, first commit {commit}). You run these steps; Finite Monkey never runs them:",
  "secrets.purge.step1": "1. Confirm the old key is revoked at the provider and the new one works in every consumer.",
  "secrets.purge.step2": "2. Outside the repository, write a replacements file with one line per leaked value: <value>==>REMOVED. Copy the value from your own records; Finite Monkey never stores or prints it.",
  "secrets.purge.step3": "3. In a fresh mirror clone, run: git filter-repo --replace-text <replacements file>",
  "secrets.purge.step4": "4. Relax branch protection yourself, push the rewritten refs, restore the protection and tell everyone with a clone to clone again.",
  "secrets.purge.step5": "5. Close the incident: finitemonkey secrets incident close {id}",
  "secrets.error.found": "{count} secret finding(s) outside the baseline or with an expired acceptance",
  "secrets.error.one_mode": "Choose only one of --staged, --history and --path",
  "secrets.error.git_unavailable": "The scan could not read git ({detail})",
  "secrets.error.baseline_invalid": "The baseline {file} is invalid: {detail}",
  "secrets.error.person_only": "Only the person can {action}, and this does not look like their terminal (no TTY, or running inside Claude Code)",
  "secrets.error.reason_required": "--reason is required: say why this finding is acceptable",
  "secrets.error.finding_not_found": "No current finding has the id {id}",
  "secrets.error.incident_not_found": "No incident has the id {id}",
  "secrets.error.not_rotated": "Incident {id} is {state}: rotate the key at the provider first, then mark it rotated",
  "secrets.error.bad_transition": "Incident {id} cannot go from {from} to {to}",
  "secrets.error.write_failed": "Could not write {file}: {detail}",
  "install.config.header": "Finite Monkey project settings. Commit this file. `finitemonkey update` keeps your edits.",
  "install.plan.title": "Finite Monkey plan for {root} (preset {preset}):",
  "install.warning": "warning: {message}",
  "install.warn.not_git": "this folder is not inside a git repository; installing here anyway",
  "install.warn.fail_open": "Claude Code {version} cannot block an action when a hook crashes (needs 2.1.295 or newer); guards fail open until you update Claude Code",
  "install.warn.authority": "{name} ({source}) also decides when a session may stop; Finite Monkey works alongside it and never turns it off",
  "install.warn.plugin": "the finitemonkey plugin is enabled ({source}); its hooks step aside while this project has its own Finite Monkey hooks",
  "install.warn.foreign": "{path} already exists and was not written by Finite Monkey; left untouched (proposed content in the diff)",
  "install.warn.edited": "{path} was edited after install; your version is kept (the new template is in the diff)",
  "install.warn.edited_kept": "kept {path}: you edited it after install",
  "install.dry_run": "Dry run: nothing was written.",
  "install.nothing_to_do": "Already up to date. Nothing to write.",
  "install.up_to_date": "The files Finite Monkey manages match this version.",
  "install.confirm_question": "apply the plan above (every touched file is backed up first)?",
  "install.done_init": "Installed. Open Claude Code and keep working: one monkey, finite time, finished work.",
  "install.done_update": "Updated. Your edits were kept.",
  "install.uninstall.title": "Removing Finite Monkey from {root}:",
  "install.uninstall.keeps_state": ".finitemonkey/ stays (backups and evidence). Add --purge to delete it too.",
  "install.uninstall.purge": ".finitemonkey/ will be deleted, including backups and evidence.",
  "install.uninstall.outside": "Not touched here, remove it yourself if you installed it: {command}",
  "install.uninstall.question": "remove what Finite Monkey added and restore the backups?",
  "install.uninstall.done": "Removed. The project is back to how it was, except files you edited.",
  "error.settings_unreadable": ".claude/settings.json is not valid JSON ({detail}), so it was not changed",
  "error.lock_unreadable": ".finitemonkey/lock.json is unreadable ({detail})",
  "error.install_locked": "another finitemonkey run holds {path}",
  "error.install_failed": "could not write {path} ({detail}); every file written in this run was put back",
  "error.not_installed": "Finite Monkey is not installed in this project (no .finitemonkey/lock.json)",
  "error.install_outdated": "the files Finite Monkey manages differ from this version",
  "error.invalid_preset": 'Unknown preset "{preset}". Use neutral or gabriel'
};

// src/i18n/es.json
var es_default = {
  "command.init.summary": "Instala Finite Monkey en este proyecto",
  "command.doctor.summary": "Revisa el entorno y dice cómo corregir cada problema",
  "command.update.summary": "Actualiza los archivos que Finite Monkey generó",
  "command.uninstall.summary": "Quita Finite Monkey de este proyecto",
  "command.i18n_check.summary": "Revisa que los catálogos pt-BR, en y es coincidan",
  "command.hook.summary": "Responde a un evento de hook de Claude Code (lee JSON de la entrada estándar)",
  "command.version.summary": "Muestra la versión",
  "command.help.summary": "Muestra comandos y opciones",
  "help.tagline": "Infinite monkeys not required.",
  "help.usage": "Uso",
  "help.command": "comando",
  "help.commands": "Comandos",
  "help.flags": "Opciones globales",
  "help.options": "Opciones",
  "help.planned": "(aún no disponible)",
  "help.more": "Ejecuta `finitemonkey help <comando>` para más detalles. Usa --json para una salida legible por máquina.",
  "flag.json": "Imprime un objeto JSON (schemaVersion 1) en lugar de texto",
  "flag.lang": "Idioma de los mensajes",
  "flag.yes": "Responde sí a las confirmaciones",
  "flag.dry_run": "Muestra qué cambiaría sin cambiar nada",
  "flag.version": "Muestra la versión",
  "flag.help": "Muestra la ayuda",
  "output.error": "error: {message}",
  "output.fix": "cómo corregir: {fix}",
  "output.next": "siguiente paso: {next}",
  "error.internal": "Finite Monkey falló de forma inesperada: {detail}",
  "error.invalid_arguments": "Argumentos inválidos: {detail}",
  "error.unexpected_argument": 'Argumento inesperado "{argument}"',
  "error.unknown_command": 'Comando desconocido "{command}"',
  "error.unknown_command_suggest": 'Comando desconocido "{command}". ¿Quisiste decir "{suggestion}"?',
  "error.not_implemented": '"{command}" aún no está disponible en esta versión',
  "error.invalid_lang": 'Idioma no soportado "{lang}". Usa uno de estos: {languages}',
  "error.i18n_catalog_unreadable": "No se pudo leer el catálogo {file}: {detail}",
  "error.i18n_mismatch": "{count} problema(s) en los catálogos",
  "error.doctor_failed": "{count} revisión(es) fallaron",
  "error.unknown_hook_event": 'Evento de hook desconocido "{event}". Usa uno de estos: {events}',
  "i18n.summary": "Idiomas: {languages}. Claves: {keys}.",
  "i18n.ok": "Todos los catálogos coinciden.",
  "i18n.fix": "Edita los catálogos en {file} para que todos los idiomas tengan las mismas claves y los mismos marcadores",
  "i18n.problem.missing": "falta la clave",
  "i18n.problem.extra": "clave que no existe en en.json",
  "i18n.problem.placeholder": "marcadores distintos (esperado: {expected}; encontrado: {actual})",
  "i18n.problem.empty": "texto vacío",
  "i18n.problem.not_string": "el valor no es texto",
  "doctor.title": "finitemonkey doctor ({version})",
  "doctor.summary": "{ok} ok, {warn} aviso(s), {fail} falla(s)",
  "doctor.node.ok": "Node.js {version}",
  "doctor.node.old": "Node.js {version} es más antiguo que el mínimo {min}",
  "doctor.node.fix": "Instala Node.js 20 o más nuevo desde https://nodejs.org",
  "doctor.git.ok": "git {version}",
  "doctor.git.missing": "No se encontró git",
  "doctor.git.fix": "Instala git desde https://git-scm.com/downloads",
  "doctor.git.old": "git {version} es más antiguo que {min}; algunos comandos necesitarán un git más nuevo",
  "doctor.git.fix_old": "Actualiza git a {min} o más nuevo",
  "doctor.claude.ok": "Claude Code {version}",
  "doctor.claude.missing": "No se encontró Claude Code; la CLI funciona sin él, los hooks lo necesitan",
  "doctor.claude.fix": "Instala Claude Code: npm install -g @anthropic-ai/claude-code",
  "doctor.claude.timeout": "`claude --version` no respondió a tiempo",
  "doctor.claude.fix_timeout": "Ejecuta `claude --version` a mano y revisa que responda",
  "doctor.os.linux": "Linux",
  "doctor.os.wsl": "Linux en WSL",
  "doctor.os.macos": "macOS",
  "doctor.os.windows": "Windows (nativo)",
  "doctor.os.other": "Sistema no reconocido ({platform})",
  "doctor.path.plain": "La ruta del proyecto no tiene espacios ni acentos",
  "doctor.path.chars": "La ruta del proyecto tiene espacios o acentos: {path}",
  "doctor.path.fix_chars": "Finite Monkey maneja esta ruta; si otra herramienta falla aquí, mueve el proyecto a una ruta sin espacios ni acentos",
  "doctor.path.synced": "El proyecto está en una carpeta sincronizada (OneDrive, Dropbox, iCloud o Google Drive): {path}",
  "doctor.path.fix_synced": "Mueve el proyecto fuera de la carpeta sincronizada para evitar conflictos de sincronización y git lento",
  "doctor.path.wsl_mount": "El proyecto está en un disco de Windows montado en WSL: {path}",
  "doctor.path.fix_wsl_mount": "Mueve el proyecto a la home de Linux (por ejemplo ~/proyectos) para tener git rápido y permisos correctos",
  "hook.failed_closed": "el hook {event} no pudo ejecutarse ({detail}) y bloqueó por seguridad. Ejecuta `finitemonkey doctor`",
  "hook.failed_open": "el hook {event} no pudo ejecutarse ({detail}); se sigue sin él. Ejecuta `finitemonkey doctor`",
  "exit.ok": "0 ok: el comando hizo lo que se pidió",
  "exit.check_failed": "1 revisión fallida: el comando se ejecutó y encontró un problema",
  "exit.usage": "2 error de uso: comando u opción desconocidos, valor inválido o comando aún no disponible",
  "exit.not_configured": "3 no configurado: falta la instalación o un requisito previo (node, git, archivos, permisos)",
  "exit.needs_person": "4 necesita a la persona: se requiere una decisión o aprobación antes de seguir",
  "exit.internal": "5 error interno: el propio Finite Monkey falló; por favor, repórtalo",
  "help.exit_codes": "Códigos de salida",
  "hook.stop_released": "el hook {event} bloquearía otra vez ({detail}), pero Claude Code ya está continuando por un hook de parada, así que deja que la sesión termine. Ejecuta `finitemonkey doctor`",
  "error.needs_confirmation": '"{command}" necesita tu decisión antes de cambiar algo: {question}',
  "secrets.command.scan": "Busca secretos en los archivos, en los cambios preparados o en el historial de git (solo local)",
  "secrets.command.accept": "Acepta un hallazgo en el baseline, con motivo y vencimiento (solo la persona)",
  "secrets.command.incident": "Lista incidentes de secretos, los marca como rotados o cerrados y muestra los pasos para limpiar el historial",
  "secrets.found_item": "{rule} en {where}",
  "secrets.found_more": "y {count} más",
  "secrets.where.line": "línea {line}, columna {column}",
  "secrets.where.file": "{file}:{line}:{column}",
  "secrets.where.new_text": "{file} (línea {line} del texto nuevo)",
  "secrets.block.write": "bloqueado: el texto nuevo de {file} tiene una credencial ({found}). No se escribió nada. Deja el valor en .env (fuera de git) y léelo por el nombre de la variable. Si la clave es real, trátala como expuesta y rótala.",
  "secrets.block.bash": "bloqueado: este comando tiene una credencial ({found}) y no se ejecutó. Lee el valor de una variable de entorno en lugar de escribirlo en el comando. Si la clave es real, trátala como expuesta y rótala.",
  "secrets.block.commit": "bloqueado: los cambios preparados tienen una credencial ({found}), así que el commit no se ejecutó. Quítala de los archivos preparados, déjala en .env (fuera de git) y rótala si es real.",
  "secrets.block.read": "bloqueado: {target} guarda secretos, y leerlo pondría sus valores en la conversación. Pide a la persona los nombres de las variables, o lee .env.example.",
  "secrets.block.env_dump": 'bloqueado: `{command}` imprime todas las variables de entorno, secretos incluidos. Imprime solo la variable que necesitas por su nombre, o comprueba que existe con `test -n "$NAME"`.',
  "secrets.block.person_only": "bloqueado: `{command}` es una decisión de la persona, no del modelo. Pide a la persona que lo ejecute en su propia terminal.",
  "secrets.block.prompt": "tu mensaje no se envió al modelo: tiene una credencial ({found}). Si esta clave se pegó en otro lugar, trátala como expuesta y rótala. Para usarla, ponla en .env y dime solo el nombre de la variable. Nunca pegues claves en el chat. Incidente: {incident}.",
  "secrets.post.context": "Finite Monkey: la salida de {tool} contenía una credencial ({found}). El incidente {incident} está abierto; rotar la clave es decisión de la persona. La salida de Finite Monkey nunca repite el valor.",
  "secrets.incident.unsaved": "no registrado ({detail})",
  "secrets.scan.title": "Búsqueda de secretos ({mode}): {total} hallados, {new} nuevos, {known} conocidos, {expired} vencidos, {fixed} corregidos",
  "secrets.scan.item": "  [{status}] {rule} {where} {mask}  id {id}",
  "secrets.scan.clean": "No se encontraron secretos. El mono se guarda sus bananas.",
  "secrets.accept.done": "Aceptado {id} ({rule} en {where}) como {state} hasta {expires}, por {owner}.",
  "secrets.action.accept": "aceptar un hallazgo",
  "secrets.action.rotated": "marcar un incidente como rotado",
  "secrets.action.close": "cerrar un incidente",
  "secrets.incident.title": "{count} incidente(s)",
  "secrets.incident.item": "  {id}  {state}  {rule}  {where}  desde {created}",
  "secrets.incident.none": "No hay incidentes de secretos.",
  "secrets.incident.marked": "El incidente {id} ahora está {state}.",
  "secrets.purge.title": "Limpieza del historial de {id} ({where}, primer commit {commit}). Estos pasos los ejecutas tú; Finite Monkey nunca los ejecuta:",
  "secrets.purge.step1": "1. Confirma que la clave vieja está revocada en el proveedor y que la nueva funciona en todos los consumidores.",
  "secrets.purge.step2": "2. Fuera del repositorio, escribe un archivo de reemplazos con una línea por valor filtrado: <valor>==>REMOVED. Copia el valor de tus propios registros; Finite Monkey nunca lo guarda ni lo imprime.",
  "secrets.purge.step3": "3. En un clon espejo nuevo, ejecuta: git filter-repo --replace-text <archivo de reemplazos>",
  "secrets.purge.step4": "4. Relaja tú la protección de la rama, envía las refs reescritas, restaura la protección y avisa a quien tenga un clon que vuelva a clonar.",
  "secrets.purge.step5": "5. Cierra el incidente: finitemonkey secrets incident close {id}",
  "secrets.error.found": "{count} hallazgo(s) de secretos fuera del baseline o con aceptación vencida",
  "secrets.error.one_mode": "Elige solo uno entre --staged, --history y --path",
  "secrets.error.git_unavailable": "La búsqueda no pudo leer git ({detail})",
  "secrets.error.baseline_invalid": "El baseline {file} no es válido: {detail}",
  "secrets.error.person_only": "Solo la persona puede {action}, y esto no parece su terminal (sin TTY, o dentro de Claude Code)",
  "secrets.error.reason_required": "--reason es obligatorio: di por qué este hallazgo es aceptable",
  "secrets.error.finding_not_found": "Ningún hallazgo actual tiene el id {id}",
  "secrets.error.incident_not_found": "Ningún incidente tiene el id {id}",
  "secrets.error.not_rotated": "El incidente {id} está {state}: rota la clave en el proveedor primero y luego márcalo como rotado",
  "secrets.error.bad_transition": "El incidente {id} no puede pasar de {from} a {to}",
  "secrets.error.write_failed": "No se pudo escribir {file}: {detail}",
  "install.config.header": "Configuración de Finite Monkey en este proyecto. Versiona este archivo. `finitemonkey update` conserva tus cambios.",
  "install.plan.title": "Plan de Finite Monkey para {root} (preset {preset}):",
  "install.warning": "aviso: {message}",
  "install.warn.not_git": "esta carpeta no está dentro de un repositorio git; se instala aquí de todos modos",
  "install.warn.fail_open": "Claude Code {version} no puede bloquear la acción cuando un hook falla (necesita 2.1.295 o más nueva); los guardas fallan abiertos hasta que actualices Claude Code",
  "install.warn.authority": "{name} ({source}) también decide cuándo puede terminar la sesión; Finite Monkey convive con él y nunca lo desactiva",
  "install.warn.plugin": "el plugin finitemonkey está habilitado ({source}); sus hooks ceden el paso mientras este proyecto tenga sus propios hooks de Finite Monkey",
  "install.warn.foreign": "{path} ya existe y no lo escribió Finite Monkey; quedó intacto (contenido propuesto en el diff)",
  "install.warn.edited": "{path} se editó después de instalar; se conserva tu versión (la plantilla nueva está en el diff)",
  "install.warn.edited_kept": "conservado {path}: lo editaste después de instalar",
  "install.dry_run": "Simulación: no se escribió nada.",
  "install.nothing_to_do": "Ya está al día. Nada que escribir.",
  "install.up_to_date": "Los archivos que gestiona Finite Monkey coinciden con esta versión.",
  "install.confirm_question": "¿aplicar el plan de arriba (cada archivo tocado se respalda antes)?",
  "install.done_init": "Instalado. Abre Claude Code y sigue trabajando: un mono, tiempo finito, trabajo terminado.",
  "install.done_update": "Actualizado. Se conservaron tus cambios.",
  "install.uninstall.title": "Quitando Finite Monkey de {root}:",
  "install.uninstall.keeps_state": ".finitemonkey/ se queda (respaldos y evidencias). Usa --purge para borrarlo también.",
  "install.uninstall.purge": ".finitemonkey/ se borrará, incluidos respaldos y evidencias.",
  "install.uninstall.outside": "No se toca aquí, quítalo tú si lo instalaste: {command}",
  "install.uninstall.question": "¿quitar lo que agregó Finite Monkey y restaurar los respaldos?",
  "install.uninstall.done": "Quitado. El proyecto volvió a como estaba, salvo los archivos que editaste.",
  "error.settings_unreadable": ".claude/settings.json no es JSON válido ({detail}), así que no se cambió",
  "error.lock_unreadable": ".finitemonkey/lock.json no se puede leer ({detail})",
  "error.install_locked": "otra ejecución de finitemonkey tiene {path}",
  "error.install_failed": "no se pudo escribir {path} ({detail}); se restauró cada archivo escrito en esta ejecución",
  "error.not_installed": "Finite Monkey no está instalado en este proyecto (no hay .finitemonkey/lock.json)",
  "error.install_outdated": "los archivos que gestiona Finite Monkey difieren de esta versión",
  "error.invalid_preset": 'Preset desconocido "{preset}". Usa neutral o gabriel'
};

// src/i18n/pt-BR.json
var pt_BR_default = {
  "command.init.summary": "Instala o Finite Monkey neste projeto",
  "command.doctor.summary": "Confere o ambiente e diz como corrigir cada problema",
  "command.update.summary": "Atualiza os arquivos que o Finite Monkey gerou",
  "command.uninstall.summary": "Remove o Finite Monkey deste projeto",
  "command.i18n_check.summary": "Confere se os catálogos pt-BR, en e es batem",
  "command.hook.summary": "Responde a um evento de hook do Claude Code (lê JSON da entrada padrão)",
  "command.version.summary": "Mostra a versão",
  "command.help.summary": "Mostra comandos e opções",
  "help.tagline": "Infinite monkeys not required.",
  "help.usage": "Uso",
  "help.command": "comando",
  "help.commands": "Comandos",
  "help.flags": "Opções globais",
  "help.options": "Opções",
  "help.planned": "(ainda não disponível)",
  "help.more": "Rode `finitemonkey help <comando>` para detalhes. Use --json para saída legível por máquina.",
  "flag.json": "Imprime um objeto JSON (schemaVersion 1) no lugar de texto",
  "flag.lang": "Idioma das mensagens",
  "flag.yes": "Responde sim às confirmações",
  "flag.dry_run": "Mostra o que mudaria sem mudar nada",
  "flag.version": "Mostra a versão",
  "flag.help": "Mostra a ajuda",
  "output.error": "erro: {message}",
  "output.fix": "como corrigir: {fix}",
  "output.next": "próximo passo: {next}",
  "error.internal": "O Finite Monkey falhou de forma inesperada: {detail}",
  "error.invalid_arguments": "Argumentos inválidos: {detail}",
  "error.unexpected_argument": 'Argumento inesperado "{argument}"',
  "error.unknown_command": 'Comando desconhecido "{command}"',
  "error.unknown_command_suggest": 'Comando desconhecido "{command}". Você quis dizer "{suggestion}"?',
  "error.not_implemented": '"{command}" ainda não está disponível nesta versão',
  "error.invalid_lang": 'Idioma não suportado "{lang}". Use um destes: {languages}',
  "error.i18n_catalog_unreadable": "Não foi possível ler o catálogo {file}: {detail}",
  "error.i18n_mismatch": "{count} problema(s) nos catálogos",
  "error.doctor_failed": "{count} verificação(ões) falharam",
  "error.unknown_hook_event": 'Evento de hook desconhecido "{event}". Use um destes: {events}',
  "i18n.summary": "Idiomas: {languages}. Chaves: {keys}.",
  "i18n.ok": "Todos os catálogos batem.",
  "i18n.fix": "Edite os catálogos em {file} para que todos os idiomas tenham as mesmas chaves e os mesmos marcadores",
  "i18n.problem.missing": "chave faltando",
  "i18n.problem.extra": "chave que não existe no en.json",
  "i18n.problem.placeholder": "marcadores diferentes (esperado: {expected}; encontrado: {actual})",
  "i18n.problem.empty": "texto vazio",
  "i18n.problem.not_string": "valor não é texto",
  "doctor.title": "finitemonkey doctor ({version})",
  "doctor.summary": "{ok} ok, {warn} aviso(s), {fail} falha(s)",
  "doctor.node.ok": "Node.js {version}",
  "doctor.node.old": "Node.js {version} é mais antigo que o mínimo {min}",
  "doctor.node.fix": "Instale o Node.js 20 ou mais novo em https://nodejs.org",
  "doctor.git.ok": "git {version}",
  "doctor.git.missing": "git não foi encontrado",
  "doctor.git.fix": "Instale o git em https://git-scm.com/downloads",
  "doctor.git.old": "git {version} é mais antigo que {min}; alguns comandos vão precisar de um git mais novo",
  "doctor.git.fix_old": "Atualize o git para {min} ou mais novo",
  "doctor.claude.ok": "Claude Code {version}",
  "doctor.claude.missing": "Claude Code não foi encontrado; a CLI funciona sem ele, os hooks precisam dele",
  "doctor.claude.fix": "Instale o Claude Code: npm install -g @anthropic-ai/claude-code",
  "doctor.claude.timeout": "`claude --version` não respondeu a tempo",
  "doctor.claude.fix_timeout": "Rode `claude --version` à mão e confira se ele responde",
  "doctor.os.linux": "Linux",
  "doctor.os.wsl": "Linux no WSL",
  "doctor.os.macos": "macOS",
  "doctor.os.windows": "Windows (nativo)",
  "doctor.os.other": "Sistema não reconhecido ({platform})",
  "doctor.path.plain": "O caminho do projeto não tem espaço nem acento",
  "doctor.path.chars": "O caminho do projeto tem espaço ou acento: {path}",
  "doctor.path.fix_chars": "O Finite Monkey lida com este caminho; se outra ferramenta falhar aqui, mova o projeto para um caminho sem espaço nem acento",
  "doctor.path.synced": "O projeto está numa pasta sincronizada (OneDrive, Dropbox, iCloud ou Google Drive): {path}",
  "doctor.path.fix_synced": "Mova o projeto para fora da pasta sincronizada para evitar conflito de sincronização e git lento",
  "doctor.path.wsl_mount": "O projeto está num disco do Windows montado no WSL: {path}",
  "doctor.path.fix_wsl_mount": "Mova o projeto para a home do Linux (por exemplo ~/projetos) para ter git rápido e permissões corretas",
  "hook.failed_closed": "o hook {event} não conseguiu rodar ({detail}) e bloqueou por segurança. Rode `finitemonkey doctor`",
  "hook.failed_open": "o hook {event} não conseguiu rodar ({detail}); seguindo sem ele. Rode `finitemonkey doctor`",
  "exit.ok": "0 ok: o comando fez o que foi pedido",
  "exit.check_failed": "1 verificação reprovada: o comando rodou e achou um problema",
  "exit.usage": "2 erro de uso: comando ou opção desconhecidos, valor inválido ou comando ainda não disponível",
  "exit.not_configured": "3 não configurado: falta instalação ou um pré-requisito (node, git, arquivos, permissões)",
  "exit.needs_person": "4 precisa da pessoa: uma decisão ou aprovação é necessária antes de seguir",
  "exit.internal": "5 erro interno: o próprio Finite Monkey falhou; por favor, reporte",
  "help.exit_codes": "Códigos de saída",
  "hook.stop_released": "o hook {event} bloquearia de novo ({detail}), mas o Claude Code já está continuando por causa de um hook de parada, então ele deixa a sessão parar. Rode `finitemonkey doctor`",
  "error.needs_confirmation": '"{command}" precisa da sua decisão antes de mudar qualquer coisa: {question}',
  "secrets.command.scan": "Procura segredos nos arquivos, nas mudanças preparadas ou no histórico do git (só local)",
  "secrets.command.accept": "Aceita um achado no baseline, com motivo e validade (só a pessoa)",
  "secrets.command.incident": "Lista incidentes de segredo, marca como rotacionado ou fechado e mostra os passos de limpeza do histórico",
  "secrets.found_item": "{rule} em {where}",
  "secrets.found_more": "e mais {count}",
  "secrets.where.line": "linha {line}, coluna {column}",
  "secrets.where.file": "{file}:{line}:{column}",
  "secrets.where.new_text": "{file} (linha {line} do texto novo)",
  "secrets.block.write": "bloqueado: o texto novo de {file} tem uma credencial ({found}). Nada foi gravado. Deixe o valor no .env (fora do git) e leia pelo nome da variável. Se a chave é real, trate como exposta e troque.",
  "secrets.block.bash": "bloqueado: este comando tem uma credencial ({found}) e não rodou. Leia o valor de uma variável de ambiente em vez de escrevê-lo no comando. Se a chave é real, trate como exposta e troque.",
  "secrets.block.commit": "bloqueado: as mudanças preparadas têm uma credencial ({found}), então o commit não rodou. Tire-a dos arquivos preparados, deixe no .env (fora do git) e troque a chave se for real.",
  "secrets.block.read": "bloqueado: {target} guarda segredos, e lê-lo colocaria os valores na conversa. Peça à pessoa os nomes das variáveis, ou leia o .env.example.",
  "secrets.block.env_dump": 'bloqueado: `{command}` imprime todas as variáveis de ambiente, segredos inclusive. Imprima só a variável que precisa, pelo nome, ou confira que ela existe com `test -n "$NAME"`.',
  "secrets.block.person_only": "bloqueado: `{command}` é decisão da pessoa, não do modelo. Peça à pessoa que rode no terminal dela.",
  "secrets.block.prompt": "sua mensagem não foi enviada ao modelo: ela tem uma credencial ({found}). Se essa chave foi colada em outro lugar, trate como exposta e troque. Para usá-la, ponha no .env e me diga só o nome da variável. Nunca cole chaves na conversa. Incidente: {incident}.",
  "secrets.post.context": "Finite Monkey: a saída de {tool} continha uma credencial ({found}). O incidente {incident} está aberto; trocar a chave é decisão da pessoa. A saída do Finite Monkey nunca repete o valor.",
  "secrets.incident.unsaved": "não registrado ({detail})",
  "secrets.scan.title": "Varredura de segredos ({mode}): {total} achados, {new} novos, {known} conhecidos, {expired} vencidos, {fixed} corrigidos",
  "secrets.scan.item": "  [{status}] {rule} {where} {mask}  id {id}",
  "secrets.scan.clean": "Nenhum segredo encontrado. O macaco guarda as bananas para si.",
  "secrets.accept.done": "Aceito {id} ({rule} em {where}) como {state} até {expires}, por {owner}.",
  "secrets.action.accept": "aceitar um achado",
  "secrets.action.rotated": "marcar um incidente como rotacionado",
  "secrets.action.close": "fechar um incidente",
  "secrets.incident.title": "{count} incidente(s)",
  "secrets.incident.item": "  {id}  {state}  {rule}  {where}  desde {created}",
  "secrets.incident.none": "Nenhum incidente de segredo.",
  "secrets.incident.marked": "O incidente {id} agora está {state}.",
  "secrets.purge.title": "Limpeza do histórico de {id} ({where}, primeiro commit {commit}). Quem roda estes passos é você; o Finite Monkey nunca os roda:",
  "secrets.purge.step1": "1. Confirme que a chave antiga foi revogada no provedor e que a nova funciona em todos os consumidores.",
  "secrets.purge.step2": "2. Fora do repositório, escreva um arquivo de substituições com uma linha por valor vazado: <valor>==>REMOVED. Copie o valor dos seus registros; o Finite Monkey nunca o guarda nem imprime.",
  "secrets.purge.step3": "3. Num clone espelho novo, rode: git filter-repo --replace-text <arquivo de substituições>",
  "secrets.purge.step4": "4. Afrouxe a proteção da branch você mesmo, envie as refs reescritas, restaure a proteção e avise quem tem clone para clonar de novo.",
  "secrets.purge.step5": "5. Feche o incidente: finitemonkey secrets incident close {id}",
  "secrets.error.found": "{count} achado(s) de segredo fora do baseline ou com aceite vencido",
  "secrets.error.one_mode": "Escolha só um entre --staged, --history e --path",
  "secrets.error.git_unavailable": "A varredura não conseguiu ler o git ({detail})",
  "secrets.error.baseline_invalid": "O baseline {file} é inválido: {detail}",
  "secrets.error.person_only": "Só a pessoa pode {action}, e isto não parece o terminal dela (sem TTY, ou rodando dentro do Claude Code)",
  "secrets.error.reason_required": "--reason é obrigatório: diga por que este achado é aceitável",
  "secrets.error.finding_not_found": "Nenhum achado atual tem o id {id}",
  "secrets.error.incident_not_found": "Nenhum incidente tem o id {id}",
  "secrets.error.not_rotated": "O incidente {id} está {state}: troque a chave no provedor primeiro e depois marque como rotacionado",
  "secrets.error.bad_transition": "O incidente {id} não pode ir de {from} para {to}",
  "secrets.error.write_failed": "Não foi possível gravar {file}: {detail}",
  "install.config.header": "Configuração do Finite Monkey neste projeto. Versione este arquivo. O `finitemonkey update` mantém suas edições.",
  "install.plan.title": "Plano do Finite Monkey para {root} (preset {preset}):",
  "install.warning": "aviso: {message}",
  "install.warn.not_git": "esta pasta não está dentro de um repositório git; instalando aqui mesmo assim",
  "install.warn.fail_open": "o Claude Code {version} não consegue barrar a ação quando um hook quebra (precisa da 2.1.295 ou mais nova); as travas falham abertas até você atualizar o Claude Code",
  "install.warn.authority": "{name} ({source}) também decide quando a sessão pode parar; o Finite Monkey convive com ele e nunca o desliga",
  "install.warn.plugin": "o plugin finitemonkey está habilitado ({source}); os hooks dele cedem a vez enquanto este projeto tiver os próprios hooks do Finite Monkey",
  "install.warn.foreign": "{path} já existe e não foi escrito pelo Finite Monkey; ficou intocado (conteúdo proposto no diff)",
  "install.warn.edited": "{path} foi editado depois da instalação; sua versão foi mantida (o modelo novo está no diff)",
  "install.warn.edited_kept": "mantido {path}: você o editou depois da instalação",
  "install.dry_run": "Simulação: nada foi gravado.",
  "install.nothing_to_do": "Já está em dia. Nada a gravar.",
  "install.up_to_date": "Os arquivos que o Finite Monkey gerencia batem com esta versão.",
  "install.confirm_question": "aplicar o plano acima (todo arquivo tocado ganha backup antes)?",
  "install.done_init": "Instalado. Abra o Claude Code e siga trabalhando: um macaco, tempo finito, trabalho terminado.",
  "install.done_update": "Atualizado. Suas edições foram mantidas.",
  "install.uninstall.title": "Removendo o Finite Monkey de {root}:",
  "install.uninstall.keeps_state": ".finitemonkey/ fica (backups e evidências). Use --purge para apagar também.",
  "install.uninstall.purge": ".finitemonkey/ será apagado, inclusive backups e evidências.",
  "install.uninstall.outside": "Não mexido aqui, remova você mesmo se instalou: {command}",
  "install.uninstall.question": "remover o que o Finite Monkey acrescentou e restaurar os backups?",
  "install.uninstall.done": "Removido. O projeto voltou ao que era, exceto os arquivos que você editou.",
  "error.settings_unreadable": ".claude/settings.json não é JSON válido ({detail}), então não foi alterado",
  "error.lock_unreadable": ".finitemonkey/lock.json está ilegível ({detail})",
  "error.install_locked": "outra execução do finitemonkey está segurando {path}",
  "error.install_failed": "não foi possível gravar {path} ({detail}); todo arquivo gravado nesta execução foi restaurado",
  "error.not_installed": "O Finite Monkey não está instalado neste projeto (sem .finitemonkey/lock.json)",
  "error.install_outdated": "os arquivos que o Finite Monkey gerencia diferem desta versão",
  "error.invalid_preset": 'Preset desconhecido "{preset}". Use neutral ou gabriel'
};

// src/i18n/catalogs.ts
var exact = (catalog) => catalog;
var catalogs = {
  en: exact(en_default),
  "pt-BR": exact(pt_BR_default),
  es: exact(es_default)
};

// src/i18n/languages.ts
var LANGUAGES = ["en", "pt-BR", "es"];
var SOURCE_LANG = "en";
var normalizeLang = (raw) => {
  if (raw === void 0) return void 0;
  const base = (raw.trim().split(/[.@:]/)[0] ?? "").replace(/_/g, "-").toLowerCase();
  if (base === "pt" || base.startsWith("pt-")) return "pt-BR";
  if (base === "es" || base.startsWith("es-")) return "es";
  if (base === "en" || base.startsWith("en-")) return "en";
  return void 0;
};
var LANG_ENV_ORDER = ["FINITEMONKEY_LANG", "LC_ALL", "LC_MESSAGES", "LANG"];
var detectLang = (flag2, env) => {
  const fromFlag = normalizeLang(flag2);
  if (fromFlag) return { lang: fromFlag, source: "flag" };
  for (const name of LANG_ENV_ORDER) {
    const lang = normalizeLang(env[name]);
    if (lang) return { lang, source: name };
  }
  return { lang: SOURCE_LANG, source: "default" };
};

// src/i18n/translate.ts
var PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
var interpolate = (template, params = {}) => template.replace(PLACEHOLDER, (match, name) => {
  const value = params[name];
  return value === void 0 ? match : String(value);
});
var placeholdersOf = (template) => [...new Set(Array.from(template.matchAll(PLACEHOLDER), (match) => match[1] ?? ""))].sort();
var createTranslator = (lang, source = catalogs) => (key, params) => interpolate(source[lang][key] ?? source[SOURCE_LANG][key] ?? key, params);

// src/i18n/check.ts
var sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
var valueProblems = (lang, catalog, reference) => Object.keys(catalog).sort().flatMap((key) => {
  const value = catalog[key];
  if (typeof value !== "string") return [{ lang, key, kind: "not_string" }];
  const problems = [];
  if (value.trim() === "") problems.push({ lang, key, kind: "empty" });
  if (!(key in reference)) problems.push({ lang, key, kind: "extra" });
  return problems;
});
var parityProblems = (lang, catalog, reference) => Object.keys(reference).sort().flatMap((key) => {
  const value = catalog[key];
  const source = reference[key];
  if (value === void 0) return [{ lang, key, kind: "missing" }];
  if (typeof value !== "string" || typeof source !== "string") return [];
  const expected = placeholdersOf(source);
  const actual = placeholdersOf(value);
  return sameList(expected, actual) ? [] : [{ lang, key, kind: "placeholder", expected, actual }];
});
var checkCatalogs = (input) => {
  const reference = input[SOURCE_LANG];
  const problems = LANGUAGES.flatMap(
    (lang) => lang === SOURCE_LANG ? valueProblems(lang, input[lang], reference) : [...valueProblems(lang, input[lang], reference), ...parityProblems(lang, input[lang], reference)]
  );
  return { languages: LANGUAGES, keys: Object.keys(reference).length, problems };
};

// src/commands/i18n-check.ts
var unreadable = (dir, file, detail) => ({
  code: "i18n_catalog_unreadable",
  messageKey: "error.i18n_catalog_unreadable",
  params: { file, detail },
  fix: `finitemonkey i18n check --dir ${dir}`,
  exitCode: ExitCode.NotConfigured
});
var readCatalog = (ctx, dir, lang) => {
  const file = toAbsolutePath(join6(dir, `${lang}.json`));
  const text2 = ctx.runtime.readText(file);
  if (!text2.ok) return reject(unreadable(dir, file, text2.error));
  const parsed = parseJsonObject(text2.value);
  return parsed.ok ? parsed : reject(unreadable(dir, file, parsed.error));
};
var loadCatalogs = (ctx, dir) => {
  const en = readCatalog(ctx, dir, "en");
  if (!en.ok) return en;
  const ptBR = readCatalog(ctx, dir, "pt-BR");
  if (!ptBR.ok) return ptBR;
  const es = readCatalog(ctx, dir, "es");
  if (!es.ok) return es;
  return accept({ en: en.value, "pt-BR": ptBR.value, es: es.value });
};
var describeProblem = (ctx, problem2) => {
  const kind = ctx.t(`i18n.problem.${problem2.kind}`, {
    expected: (problem2.expected ?? []).join(", "),
    actual: (problem2.actual ?? []).join(", ")
  });
  return `  ${problem2.lang}  ${problem2.key}  ${kind}`;
};
var runI18nCheck = (ctx, dir) => {
  const input = dir === void 0 ? accept(catalogs) : loadCatalogs(ctx, dir);
  if (!input.ok) return failureFrom(ctx.t, input.error);
  const report = checkCatalogs(input.value);
  const data = { ...report, source: dir ?? "bundled" };
  const summary = ctx.t("i18n.summary", { languages: report.languages.join(", "), keys: report.keys });
  if (report.problems.length === 0) return success(data, [summary, ctx.t("i18n.ok")]);
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human: [summary, ...report.problems.map((problem2) => describeProblem(ctx, problem2))],
    error: {
      code: "i18n_mismatch",
      message: ctx.t("error.i18n_mismatch", { count: report.problems.length }),
      fix: ctx.t("i18n.fix", { file: dir ?? "src/i18n" })
    }
  };
};
var i18nCheckCommand = {
  path: ["i18n", "check"],
  summaryKey: "command.i18n_check.summary",
  usage: "finitemonkey i18n check [--dir <path>]",
  status: "ready",
  options: { dir: { type: "string" } },
  run: (ctx, args) => {
    const dir = stringOption(args.values, "dir");
    return Promise.resolve(runI18nCheck(ctx, dir === void 0 ? void 0 : toAbsolutePath(dir, ctx.cwd)));
  }
};

// src/secrets/project.ts
var projectRoot = (ctx) => {
  const top = ctx.runtime.git(["rev-parse", "--show-toplevel"], ctx.cwd);
  const path = top.stdout.trim();
  return top.ok && path !== "" ? toAbsolutePath(path) : ctx.cwd;
};
var isPerson = (ctx) => ctx.io.stdin.isTTY === true && ctx.env["CLAUDECODE"] === void 0 && ctx.env["CLAUDE_CODE_ENTRYPOINT"] === void 0;
var personName = (ctx) => {
  const name = ctx.runtime.git(["config", "user.name"], ctx.cwd).stdout.trim();
  return name !== "" ? name : ctx.env["USER"] ?? ctx.env["USERNAME"] ?? "person";
};

// src/commands/secrets-problems.ts
var baselineInvalid = (detail) => ({
  code: "secrets_baseline_invalid",
  messageKey: "secrets.error.baseline_invalid",
  params: { file: BASELINE_FILE, detail },
  fix: `git checkout -- ${BASELINE_FILE}`,
  exitCode: ExitCode.NotConfigured
});
var writeFailed = (file, detail) => ({
  code: "secrets_write_failed",
  messageKey: "secrets.error.write_failed",
  params: { file, detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.Internal
});
var gitUnavailable = (detail) => ({
  code: "secrets_git_unavailable",
  messageKey: "secrets.error.git_unavailable",
  params: { detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.NotConfigured
});

// src/commands/secrets-accept.ts
var DAY_MS = 864e5;
var daysOf = (values) => {
  const raw = stringOption(values, "days");
  if (raw === void 0) return EXCEPTION_MAX_DAYS;
  const days = Number.parseInt(raw, 10);
  return Number.isInteger(days) && days > 0 && days <= EXCEPTION_MAX_DAYS ? days : void 0;
};
var plusDays = (iso, days) => new Date(Date.parse(iso) + days * DAY_MS).toISOString();
var failure = (ctx, problem2) => failureFrom(ctx.t, problem2);
var inputProblem = (ctx, id, reason, days) => {
  const fix = "finitemonkey secrets accept <id> --reason <why> [--days 1-90] [--false-positive]";
  if (!isPerson(ctx)) {
    return needsPersonProblem("secrets.error.person_only", fix, { action: ctx.t("secrets.action.accept") });
  }
  if (id === "") return usageProblem("invalid_arguments", "error.invalid_arguments", fix, { detail: "<id>" });
  if (reason === void 0 || reason.trim() === "") {
    return usageProblem("invalid_arguments", "secrets.error.reason_required", fix);
  }
  if (days === void 0) {
    return usageProblem("invalid_arguments", "error.invalid_arguments", fix, {
      detail: `--days 1-${String(EXCEPTION_MAX_DAYS)}`
    });
  }
  return void 0;
};
var entryOf = (ctx, finding, args) => {
  const now = ctx.runtime.now();
  return {
    id: finding.id,
    rule: finding.ruleId,
    file: finding.file,
    line: finding.line,
    fingerprint: finding.fingerprint,
    state: args.falsePositive ? "falso-positivo" : "aceito",
    owner: personName(ctx),
    reason: args.reason,
    acceptedAt: now,
    expiresAt: plusDays(now, args.days)
  };
};
var acceptEntry = (ctx, args) => {
  const root = projectRoot(ctx);
  const baseline = loadBaseline(ctx.runtime, root);
  if (!baseline.ok) {
    return failure(ctx, baselineInvalid(baseline.error));
  }
  const scanned = scanPath(ctx.runtime, root, ".");
  const finding = scanned.ok ? scanned.value.find((item) => item.id === args.id) : void 0;
  if (finding === void 0) {
    return failure(
      ctx,
      usageProblem("secrets_finding_not_found", "secrets.error.finding_not_found", "finitemonkey secrets scan", {
        id: args.id
      })
    );
  }
  const entry = entryOf(ctx, finding, args);
  const entries = [...baseline.value.entries.filter((item) => item.id !== entry.id), entry];
  const saved = saveBaseline(ctx.runtime, root, { schema: baseline.value.schema, entries });
  if (!saved.ok) {
    return failure(ctx, writeFailed(BASELINE_FILE, saved.error));
  }
  const line = ctx.t("secrets.accept.done", {
    id: entry.id,
    rule: entry.rule,
    where: whereOf(finding),
    state: entry.state,
    expires: entry.expiresAt.slice(0, 10),
    owner: entry.owner
  });
  return success(entry, [line]);
};
var secretsAcceptCommand = {
  path: ["secrets", "accept"],
  summaryKey: "secrets.command.accept",
  usage: "finitemonkey secrets accept <finding-id> --reason <why> [--days 1-90] [--false-positive]",
  status: "ready",
  maxPositionals: 1,
  options: { reason: { type: "string" }, days: { type: "string" }, "false-positive": { type: "boolean" } },
  run: (ctx, args) => {
    const id = args.positionals[0] ?? "";
    const reason = stringOption(args.values, "reason");
    const days = daysOf(args.values);
    const problem2 = inputProblem(ctx, id, reason, days);
    if (problem2 !== void 0 || reason === void 0 || days === void 0) {
      return Promise.resolve(
        failure(
          ctx,
          problem2 ?? usageProblem("invalid_arguments", "secrets.error.reason_required", "finitemonkey help secrets accept")
        )
      );
    }
    return Promise.resolve(
      acceptEntry(ctx, { id, reason, days, falsePositive: args.values["false-positive"] === true })
    );
  }
};

// src/commands/secrets-incident.ts
var INCIDENT_ACTIONS = ["list", "rotated", "close", "purge"];
var USAGE = "finitemonkey secrets incident [list | rotated <id> | close <id> | purge <id>]";
var TARGET = { rotated: "rotacionado", close: "fechado" };
var PURGE_STEPS = [
  "secrets.purge.step1",
  "secrets.purge.step2",
  "secrets.purge.step3",
  "secrets.purge.step4",
  "secrets.purge.step5"
];
var fail = (ctx, problem2) => failureFrom(ctx.t, problem2);
var notFound2 = (ctx, id) => fail(
  ctx,
  usageProblem("secrets_incident_not_found", "secrets.error.incident_not_found", `finitemonkey secrets incident`, {
    id
  })
);
var itemLine = (ctx, incident) => ctx.t("secrets.incident.item", {
  id: incident.id,
  state: incident.state,
  rule: incident.rule,
  where: incident.where,
  created: incident.createdAt.slice(0, 10)
});
var list = (ctx, root) => {
  const incidents = listIncidents(ctx.runtime, root);
  const human = incidents.length === 0 ? [ctx.t("secrets.incident.none")] : [ctx.t("secrets.incident.title", { count: incidents.length }), ...incidents.map((item) => itemLine(ctx, item))];
  return success({ schema: "finitemonkey/secrets-incidents@1", incidents }, human);
};
var notRotated = (ctx, incident) => fail(ctx, {
  code: "secrets_not_rotated",
  messageKey: "secrets.error.not_rotated",
  params: { id: incident.id, state: incident.state },
  fix: `finitemonkey secrets incident rotated ${incident.id}`,
  exitCode: ExitCode.NeedsPerson
});
var move = (ctx, root, incident, action) => {
  const to = TARGET[action];
  if (!isPerson(ctx)) {
    return fail(
      ctx,
      needsPersonProblem("secrets.error.person_only", `finitemonkey secrets incident ${action} ${incident.id}`, {
        action: ctx.t(`secrets.action.${action}`)
      })
    );
  }
  if (!canMove(incident.state, to))
    return action === "close" ? notRotated(ctx, incident) : fail(
      ctx,
      usageProblem("invalid_arguments", "secrets.error.bad_transition", USAGE, {
        id: incident.id,
        from: incident.state,
        to
      })
    );
  const moved = moveIncident(incident, to, ctx.runtime.now(), personName(ctx));
  const saved = saveIncident(ctx.runtime, root, moved);
  if (!saved.ok) {
    return fail(ctx, writeFailed(incident.id, saved.error));
  }
  return success(moved, [ctx.t("secrets.incident.marked", { id: moved.id, state: moved.state })]);
};
var purge = (ctx, incident) => {
  if (!isRotated(incident)) return notRotated(ctx, incident);
  const params = { id: incident.id, where: incident.where, commit: incident.firstCommit ?? "?" };
  const steps = PURGE_STEPS.map((key) => ctx.t(key, params));
  return success({ id: incident.id, state: incident.state, steps }, [ctx.t("secrets.purge.title", params), ...steps]);
};
var actionOf = (raw) => INCIDENT_ACTIONS.find((action) => action === (raw ?? "list"));
var secretsIncidentCommand = {
  path: ["secrets", "incident"],
  summaryKey: "secrets.command.incident",
  usage: USAGE,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => {
    const action = actionOf(args.positionals[0]);
    const root = projectRoot(ctx);
    if (action === void 0)
      return Promise.resolve(
        fail(
          ctx,
          usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: args.positionals[0] ?? "" })
        )
      );
    if (action === "list") return Promise.resolve(list(ctx, root));
    const id = args.positionals[1] ?? "";
    const incident = readIncident(ctx.runtime, root, id);
    if (!incident.ok) return Promise.resolve(notFound2(ctx, id));
    return Promise.resolve(action === "purge" ? purge(ctx, incident.value) : move(ctx, root, incident.value, action));
  }
};

// src/mask/mask.ts
var maskToken = (finding) => `«secret:${finding.ruleId}:${finding.tail}»`;
var maskText = (text2) => {
  const findings = scanText(text2, { rules: CREDENTIAL_RULES });
  if (findings.length === 0) return text2;
  let out = "";
  let cursor = 0;
  for (const finding of findings) {
    out += text2.slice(cursor, finding.start) + maskToken(finding);
    cursor = finding.end;
  }
  return out + text2.slice(cursor);
};
var maskDeep = (value) => {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [maskText(key), maskDeep(inner)]));
  }
  return value;
};

// src/commands/secrets-scan.ts
var SECRETS_SCAN_SCHEMA = "finitemonkey/secrets-scan@1";
var view = (finding, status) => ({
  id: finding.id,
  rule: finding.ruleId,
  severity: finding.severity,
  file: finding.file,
  line: finding.line,
  column: finding.column,
  fingerprint: finding.fingerprint,
  mask: maskToken(finding),
  status,
  ...finding.commit === void 0 ? {} : { commit: finding.commit }
});
var modeOf2 = (values) => {
  const chosen = [values["staged"] === true, values["history"] === true, stringOption(values, "path") !== void 0];
  if (chosen.filter(Boolean).length > 1) return void 0;
  if (chosen[0] === true) return "staged";
  return chosen[1] === true ? "history" : "path";
};
var normalizedTarget = (target) => target.replace(/\\/g, "/").replace(/^\.\/?/, "").replace(/\/$/, "");
var scopeOf = (target) => {
  const prefix = normalizedTarget(target);
  return (file) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`);
};
var runScan = async (ctx, root, mode, target) => {
  if (mode === "staged") return scanStaged(ctx.runtime, root);
  if (mode === "history") return scanHistory(ctx.runtime, root);
  return scanPath(ctx.runtime, root, normalizedTarget(target) || ".");
};
var historyIncidents = (ctx, root, fresh2) => fresh2.flatMap((finding) => {
  if (ruleById(finding.ruleId)?.kind !== "credential") return [];
  const draft = {
    rule: finding.ruleId,
    fingerprint: finding.fingerprint,
    where: whereOf(finding),
    source: "history",
    state: "aberto",
    ...finding.commit === void 0 ? {} : { firstCommit: finding.commit }
  };
  const saved = recordIncident(ctx.runtime, root, draft, HOOK_ACTOR);
  return saved.ok ? [saved.value.id] : [];
});
var dataOf = (mode, outcome, incidents) => {
  const findings = [
    ...outcome.fresh.map((finding) => view(finding, "new")),
    ...outcome.known.map((finding) => view(finding, "known")),
    ...outcome.expired.map((finding) => view(finding, "expired"))
  ];
  return {
    schema: SECRETS_SCAN_SCHEMA,
    mode,
    baseline: BASELINE_FILE,
    findings,
    fixed: outcome.fixed.map((entry) => entry.id),
    incidents,
    summary: {
      total: findings.length,
      new: outcome.fresh.length,
      known: outcome.known.length,
      expired: outcome.expired.length,
      fixed: outcome.fixed.length
    }
  };
};
var humanOf = (ctx, data) => [
  ctx.t("secrets.scan.title", { mode: data.mode, ...data.summary }),
  ...data.findings.map(
    (item) => ctx.t("secrets.scan.item", {
      status: item.status,
      rule: item.rule,
      where: `${item.file}:${String(item.line)}`,
      id: item.id,
      mask: item.mask
    })
  ),
  ...data.summary.total === 0 ? [ctx.t("secrets.scan.clean")] : []
];
var resultOf = (ctx, data) => {
  const human = humanOf(ctx, data);
  const failing = data.summary.new + data.summary.expired;
  if (failing === 0) return success(data, human);
  return failureFrom(
    ctx.t,
    {
      code: "secrets_found",
      messageKey: "secrets.error.found",
      params: { count: failing },
      fix: "finitemonkey secrets accept <id> --reason <why>",
      exitCode: ExitCode.CheckFailed,
      data
    },
    human
  );
};
var prune = (ctx, root, baseline, outcome) => {
  if (outcome.fixed.length > 0) saveBaseline(ctx.runtime, root, withoutFixed(baseline, outcome.fixed));
};
var secretsScanCommand = {
  path: ["secrets", "scan"],
  summaryKey: "secrets.command.scan",
  usage: "finitemonkey secrets scan [--staged | --history | --path <dir>] [--json]",
  status: "ready",
  options: { staged: { type: "boolean" }, history: { type: "boolean" }, path: { type: "string" } },
  run: async (ctx, args) => {
    const mode = modeOf2(args.values);
    const fix = "finitemonkey help secrets scan";
    if (mode === void 0) return failureFrom(ctx.t, usageProblem("invalid_arguments", "secrets.error.one_mode", fix));
    const root = projectRoot(ctx);
    const target = stringOption(args.values, "path") ?? ".";
    const scanned = await runScan(ctx, root, mode, target);
    if (!scanned.ok) return failureFrom(ctx.t, gitUnavailable(scanned.error));
    const baseline = loadBaseline(ctx.runtime, root);
    if (!baseline.ok) return failureFrom(ctx.t, baselineInvalid(baseline.error));
    const outcome = ratchet(
      scanned.value,
      baseline.value,
      ctx.runtime.now(),
      mode === "path" ? scopeOf(target) : void 0
    );
    if (mode === "path") prune(ctx, root, baseline.value, outcome);
    const incidents = mode === "history" ? historyIncidents(ctx, root, outcome.fresh) : [];
    return resultOf(ctx, dataOf(mode, outcome, incidents));
  }
};

// src/install/apply.ts
import { dirname as dirname2 } from "node:path";

// src/install/hash.ts
import { createHash as createHash2 } from "node:crypto";
var hashText = (text2) => `sha256:${createHash2("sha256").update(text2, "utf8").digest("hex")}`;

// src/install/lock-file.ts
var ENTRY_KINDS = ["settings", "gitignore", "generated"];
var strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : void 0;
var parseAdded = (value) => {
  if (!isRecord(value)) return void 0;
  const deny = strings(value["deny"]);
  const { schema, attribution } = value;
  if (deny === void 0 || typeof schema !== "boolean" || typeof attribution !== "boolean") return void 0;
  const marketplace = value["marketplace"] === true;
  const plugin = value["plugin"] === true;
  return { schema, attribution, deny, marketplace, plugin };
};
var parseEntry2 = (value) => {
  if (!isRecord(value)) return void 0;
  const { path, kind, existed, hash, backup } = value;
  const known = ENTRY_KINDS.find((item) => item === kind);
  if (typeof path !== "string" || known === void 0 || typeof existed !== "boolean" || typeof hash !== "string") {
    return void 0;
  }
  const added = parseAdded(value["added"]);
  const handlers = Array.isArray(value["handlers"]) ? value["handlers"].filter(isRecord) : void 0;
  return {
    path,
    kind: known,
    existed,
    hash,
    ...typeof backup === "string" ? { backup } : {},
    ...added === void 0 ? {} : { added },
    ...handlers === void 0 ? {} : { handlers }
  };
};
var parseEntries = (value) => {
  if (!Array.isArray(value)) return void 0;
  const entries = value.map(parseEntry2);
  return entries.every((entry) => entry !== void 0) ? entries : void 0;
};
var fromRecord = (record2) => {
  const { schema, version, preset, installedAt, updatedAt } = record2;
  const known = PRESETS.find((item) => item === preset);
  const entries = parseEntries(record2["entries"]);
  const createdDirs = strings(record2["createdDirs"]);
  if (schema !== LOCK_SCHEMA) return reject(`schema is not ${LOCK_SCHEMA}`);
  if (typeof version !== "string" || typeof installedAt !== "string" || typeof updatedAt !== "string") {
    return reject("version, installedAt and updatedAt must be text");
  }
  if (known === void 0 || entries === void 0 || createdDirs === void 0) {
    return reject("preset, entries or createdDirs is malformed");
  }
  return accept({ schema, version, preset: known, installedAt, updatedAt, createdDirs, entries });
};
var parseLock = (text2) => {
  const parsed = parseJsonObject(text2);
  return parsed.ok ? fromRecord(parsed.value) : reject(parsed.error);
};
var renderLock = (lock) => `${JSON.stringify(lock, null, 2)}
`;

// src/install/claude-version.ts
var ON_FAILURE_MIN = [2, 1, 295];
var PROBE_MS = 8e3;
var parseClaudeVersion = (output) => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  return match === null ? void 0 : [Number(match[1]), Number(match[2]), Number(match[3])];
};
var atLeast = (version, min) => {
  for (const [index, part] of min.entries()) {
    const value = version[index] ?? 0;
    if (value !== part) return value > part;
  }
  return true;
};
var detectClaude = (probe) => {
  const result = probe("claude", ["--version"], PROBE_MS);
  const parsed = result.ok ? parseClaudeVersion(result.stdout) : void 0;
  if (parsed === void 0) return { version: void 0, failClosed: true };
  return { version: parsed.join("."), failClosed: atLeast(parsed, ON_FAILURE_MIN) };
};

// src/install/config-template.ts
var configTemplate = (t, preset, lang) => [
  `# ${GENERATED_MARKER}`,
  `# ${t("install.config.header")}`,
  "schemaVersion: 1",
  `preset: ${preset}`,
  `lang: ${lang}`,
  ""
].join("\n");

// src/install/deny-floor.ts
var DENY_FLOOR = {
  secrets: ["Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", "Read(./**/.env.*)", "Read(./**/*.pem)"],
  git: [
    "Bash(git push --force *)",
    "Bash(git push -f *)",
    "Bash(git clean -f*)",
    "Bash(git reset --hard*)",
    "Bash(git worktree remove --force*)"
  ],
  proof: [
    "Edit(./.finitemonkey/evidence/**)",
    "Edit(./.finitemonkey/lock.json)",
    "Edit(./.finitemonkey/log.jsonl)",
    "Edit(./.finitemonkey/state.md)"
  ]
};
var DENY_RULES = [...DENY_FLOOR.secrets, ...DENY_FLOOR.git, ...DENY_FLOOR.proof];

// src/install/detect.ts
import { join as join7 } from "node:path";
var PACKAGE_MANAGERS = [
  { name: "pnpm", files: ["pnpm-lock.yaml"] },
  { name: "yarn", files: ["yarn.lock"] },
  { name: "bun", files: ["bun.lock", "bun.lockb"] },
  { name: "npm", files: ["package-lock.json", "npm-shrinkwrap.json"] }
];
var LANGUAGE_MARKERS = [
  { name: "typescript", files: ["tsconfig.json"] },
  { name: "javascript", files: ["package.json"] },
  { name: "python", files: ["pyproject.toml", "requirements.txt", "setup.py"] },
  { name: "go", files: ["go.mod"] },
  { name: "rust", files: ["Cargo.toml"] },
  { name: "ruby", files: ["Gemfile"] },
  { name: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts"] }
];
var LOOP_PLUGINS = ["oh-my-claudecode", "ralph-loop", "ralph-wiggum", "everything-claude-code", "superclaude"];
var WORKFLOW_DIRS = [
  { dir: ".planning", name: "gsd" },
  { dir: ".bmad-core", name: "bmad" },
  { dir: ".specify", name: "spec-kit" },
  { dir: "openspec", name: "openspec" }
];
var fromPackageJson = (project) => {
  const text2 = project.read("package.json");
  const parsed = text2 === void 0 ? void 0 : parseJsonObject(text2);
  const field = parsed?.ok === true ? parsed.value["packageManager"] : void 0;
  if (typeof field !== "string") return void 0;
  return PACKAGE_MANAGERS.find(({ name }) => field.startsWith(`${name}@`))?.name;
};
var detectPackageManager = (project) => fromPackageJson(project) ?? PACKAGE_MANAGERS.find(({ files }) => files.some((file) => project.exists(file)))?.name;
var detectLanguages = (project) => LANGUAGE_MARKERS.filter(({ files }) => files.some((file) => project.exists(file))).map(({ name }) => name);
var handlersOf = (settings, event) => {
  const hooks = settings["hooks"];
  const groups = isRecord(hooks) ? hooks[event] : void 0;
  return asList(groups).flatMap((group) => asList(asRecord(group)["hooks"]));
};
var allHandlers = (settings) => {
  const hooks = settings["hooks"];
  return isRecord(hooks) ? Object.keys(hooks).flatMap((event) => handlersOf(settings, event)) : [];
};
var settingsInfo = (text2) => {
  if (text2 === void 0) return { exists: false, valid: true, userHooks: 0, ownHooks: 0 };
  const parsed = text2.trim() === "" ? { ok: true, value: {} } : parseJsonObject(text2);
  if (!parsed.ok) return { exists: true, valid: false, userHooks: 0, ownHooks: 0 };
  const handlers = allHandlers(parsed.value);
  const own = handlers.filter(isOwnHandler).length;
  return { exists: true, valid: true, userHooks: handlers.length - own, ownHooks: own };
};
var pluginAuthorities = (settings, source) => {
  const enabled = settings["enabledPlugins"];
  if (!isRecord(enabled)) return [];
  return Object.entries(enabled).filter(([, on]) => on === true).map(([id]) => id.split("@")[0] ?? id).flatMap((name) => {
    if (name === "finitemonkey") return [{ kind: "finitemonkey-plugin", source, name }];
    return LOOP_PLUGINS.includes(name) ? [{ kind: "loop-plugin", source, name }] : [];
  });
};
var scopeAuthorities = (text2, source) => {
  const parsed = text2 === void 0 ? void 0 : parseJsonObject(text2);
  if (parsed?.ok !== true) return [];
  const stops = ["Stop", "SubagentStop"].flatMap(
    (event) => handlersOf(parsed.value, event).filter((handler) => !isOwnHandler(handler)).map((handler) => {
      const command = isRecord(handler) ? handler["command"] : void 0;
      return { kind: "stop-hook", source, name: `${event}: ${typeof command === "string" ? command : "?"}` };
    })
  );
  return [...stops, ...pluginAuthorities(parsed.value, source)];
};
var userSettingsText = (project, env) => {
  const home = env["CLAUDE_CONFIG_DIR"] ?? env["HOME"] ?? env["USERPROFILE"];
  if (home === void 0) return void 0;
  const file = env["CLAUDE_CONFIG_DIR"] === void 0 ? join7(home, ".claude", "settings.json") : join7(home, "settings.json");
  const text2 = project.runtime.readText(toAbsolutePath(file));
  return text2.ok ? text2.value : void 0;
};
var detectAuthorities = (project, env) => [
  ...scopeAuthorities(project.read(SETTINGS_FILE), "project"),
  ...scopeAuthorities(project.read(".claude/settings.local.json"), "local"),
  ...scopeAuthorities(userSettingsText(project, env), "user"),
  ...WORKFLOW_DIRS.filter(({ dir }) => project.isDir(dir)).map(({ name }) => ({
    kind: "workflow",
    source: "project-dir",
    name
  }))
];
var chooseRunner = (project, bin, version) => {
  if (bin !== void 0) return { kind: "path", path: bin };
  return project.exists(LOCAL_BIN) ? { kind: "local" } : { kind: "npx", version };
};

// src/install/gitignore-block.ts
var gitignoreBlock = () => [
  BLOCK_BEGIN,
  `${STATE_DIR}/*`,
  ...COMMITTED_STATE.map((path) => `!${STATE_DIR}/${path}`),
  BLOCK_END
];
var lineBreak = (text2) => text2.includes("\r\n") ? "\r\n" : "\n";
var blockRange = (lines) => {
  const start = lines.findIndex((line) => line.trimEnd() === BLOCK_BEGIN);
  if (start < 0) return void 0;
  const end = lines.findIndex((line, index) => index > start && line.trimEnd() === BLOCK_END);
  return end < 0 ? void 0 : { start, end };
};
var withBlock = (text2) => {
  const eol = text2 === void 0 ? "\n" : lineBreak(text2);
  const block2 = gitignoreBlock();
  if (text2 === void 0 || text2 === "") return `${block2.join(eol)}${eol}`;
  const lines = text2.split(eol);
  const range = blockRange(lines);
  if (range !== void 0) return [...lines.slice(0, range.start), ...block2, ...lines.slice(range.end + 1)].join(eol);
  const separator = text2.endsWith(eol) ? "" : eol;
  return `${text2}${separator}${block2.join(eol)}${eol}`;
};
var withoutBlock = (text2) => {
  const eol = lineBreak(text2);
  const lines = text2.split(eol);
  const range = blockRange(lines);
  if (range === void 0) return text2;
  return [...lines.slice(0, range.start), ...lines.slice(range.end + 1)].join(eol);
};

// src/install/plan.ts
var CHANGING = ["create", "merge", "update"];
var detect = (project, gitRoot, input) => ({
  root: project.root,
  gitRoot,
  packageManager: detectPackageManager(project),
  languages: detectLanguages(project),
  settings: settingsInfo(project.read(SETTINGS_FILE)),
  authorities: detectAuthorities(project, input.env),
  runner: chooseRunner(project, input.bin, input.version),
  claude: detectClaude(project.runtime.probe)
});
var readPreviousLock = (project) => {
  const text2 = project.read(LOCK_FILE);
  if (text2 === void 0) return accept(void 0);
  const parsed = parseLock(text2);
  return parsed.ok ? accept(parsed.value) : reject({ kind: "lock", detail: parsed.error });
};
var actionFor = (before, after, existing) => {
  if (before === void 0) return "create";
  return before === after ? "unchanged" : existing;
};
var union = (a, b) => [.../* @__PURE__ */ new Set([...a, ...b])];
var joinAdded = (previous, next) => previous === void 0 ? next : {
  schema: previous.schema || next.schema,
  attribution: previous.attribution || next.attribution,
  deny: union(previous.deny, next.deny),
  marketplace: previous.marketplace || next.marketplace,
  plugin: previous.plugin || next.plugin
};
var wantedHooks = (detection) => Object.fromEntries(
  INSTALLED_HOOKS.map((spec) => [spec.event, hookHandler(detection.runner, spec, detection.claude.failClosed)])
);
var settingsItem = (project, detection, input, previous) => {
  const before = project.read(SETTINGS_FILE);
  const current = parseSettings(before);
  if (!current.ok) return reject({ kind: "settings", detail: current.error });
  const hooks = wantedHooks(detection);
  const wanted = {
    hooks,
    deny: DENY_RULES,
    attributionOff: input.preset === "gabriel",
    marketplace: input.marketplace
  };
  const merged = mergeSettings(current.value, wanted, previous?.handlers ?? []);
  const after = renderJson(merged.settings, before === void 0 ? DEFAULT_STYLE : styleOf(before));
  return accept({
    path: SETTINGS_FILE,
    kind: "settings",
    action: actionFor(before, after, "merge"),
    before,
    after,
    added: joinAdded(previous?.added, merged.added),
    handlers: Object.values(hooks)
  });
};
var gitignoreItem = (project) => {
  const before = project.read(GITIGNORE_FILE);
  const after = withBlock(before);
  return { path: GITIGNORE_FILE, kind: "gitignore", action: actionFor(before, after, "merge"), before, after };
};
var configItem = (project, input, previous) => {
  const before = project.read(CONFIG_FILE);
  const template = configTemplate(input.t, input.preset, input.lang);
  const base = { path: CONFIG_FILE, kind: "generated", before };
  if (before === void 0) return { ...base, action: "create", after: template };
  if (previous === void 0) return { ...base, action: "skip-foreign", after: before, proposal: template };
  if (hashText(before) !== previous.hash) {
    const action = before === template ? "unchanged" : "keep-edited";
    return { ...base, action, after: before, proposal: template };
  }
  return { ...base, action: actionFor(before, template, "update"), after: template };
};
var entryFor = (lock, path) => lock?.entries.find((entry) => entry.path === path);
var buildPlan = (project, detection, input, previous) => {
  const settings = settingsItem(project, detection, input, entryFor(previous, SETTINGS_FILE));
  if (!settings.ok) return settings;
  const items = [settings.value, gitignoreItem(project), configItem(project, input, entryFor(previous, CONFIG_FILE))];
  return accept({ detection, preset: input.preset, items, previous });
};
var hasChanges = (plan) => plan.items.some((item) => CHANGING.includes(item.action));

// src/install/apply.ts
var stamp = (iso) => iso.replace(/[:.]/g, "-");
var ensureParent = (project, relative4) => project.runtime.mkdir(project.abs(dirname2(relative4)));
var writeText = (project, relative4, text2) => {
  const parent = ensureParent(project, relative4);
  const written = parent.ok ? project.runtime.writeAtomic(project.abs(relative4), text2) : parent;
  return written.ok ? accept(void 0) : reject({ path: relative4, detail: written.error });
};
var restore = (project, items) => {
  for (const item of items) {
    if (item.before === void 0) project.runtime.remove(project.abs(item.path));
    else project.runtime.writeAtomic(project.abs(item.path), item.before);
  }
};
var backupItems = (project, dir, items) => {
  const manifest = items.map((item) => ({ path: item.path, hash: hashText(item.before ?? "") }));
  for (const item of items) {
    const saved = writeText(project, `${dir}/${item.path}`, item.before ?? "");
    if (!saved.ok) return saved;
  }
  return writeText(project, `${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}
`);
};
var entryOf2 = (plan, item, backupDir) => {
  const previous = plan.previous?.entries.find((entry) => entry.path === item.path);
  const existed = previous?.existed ?? item.before !== void 0;
  const backup = previous?.backup ?? (existed && backupDir !== void 0 ? `${backupDir}/${item.path}` : void 0);
  const hash = item.action === "keep-edited" ? previous?.hash ?? hashText(item.after) : hashText(item.after);
  return {
    path: item.path,
    kind: item.kind,
    existed,
    hash,
    ...backup === void 0 ? {} : { backup },
    ...item.added === void 0 ? {} : { added: item.added },
    ...item.handlers === void 0 ? {} : { handlers: item.handlers }
  };
};
var nextLock = (plan, version, now, backupDir, createdDirs) => ({
  schema: LOCK_SCHEMA,
  version,
  preset: plan.preset,
  installedAt: plan.previous?.installedAt ?? now,
  updatedAt: now,
  createdDirs: plan.previous?.createdDirs ?? createdDirs,
  entries: plan.items.filter((item) => item.action !== "skip-foreign").map((item) => entryOf2(plan, item, backupDir))
});
var needsBackup = (plan, item) => item.before !== void 0 && plan.previous?.entries.find((entry) => entry.path === item.path)?.backup === void 0;
var writeAll = (project, items) => {
  const done = [];
  for (const item of items) {
    const written = writeText(project, item.path, item.after);
    if (!written.ok) {
      restore(project, done);
      return written;
    }
    done.push(item);
  }
  return accept(void 0);
};
var createdBy = (project) => [".claude", STATE_DIR].filter((dir) => !project.exists(dir));
var commit = (project, plan, version, createdDirs) => {
  const now = project.runtime.now();
  const changing = plan.items.filter((item) => CHANGING.includes(item.action));
  const toBackup = changing.filter((item) => needsBackup(plan, item));
  const backupDir = toBackup.length === 0 ? void 0 : `${BACKUPS_DIR}/${stamp(now)}`;
  if (backupDir !== void 0) {
    const saved = backupItems(project, backupDir, toBackup);
    if (!saved.ok) return saved;
  }
  const written = writeAll(project, changing);
  if (!written.ok) return written;
  const lock = nextLock(plan, version, now, backupDir, createdDirs);
  const locked = writeText(project, LOCK_FILE, renderLock(lock));
  if (!locked.ok) {
    restore(project, changing);
    return locked;
  }
  return accept({ lock, written: changing.map((item) => item.path), backup: backupDir });
};
var withInstallLock = (project, work) => {
  const dir = project.runtime.mkdir(project.abs(LOCKS_DIR));
  if (!dir.ok) return reject({ path: LOCKS_DIR, detail: dir.error });
  const lock = project.runtime.lock(project.abs(INSTALL_LOCK), {
    staleMs: INSTALL_LOCK_STALE_MS,
    owner: "finitemonkey"
  });
  if (!lock.ok) return reject({ path: INSTALL_LOCK, detail: lock.error });
  try {
    return work();
  } finally {
    lock.value();
  }
};
var applyPlan = (project, plan, version) => {
  const created2 = createdBy(project);
  return withInstallLock(project, () => commit(project, plan, version, created2));
};

// src/install/diff.ts
var MAX_DIFF_LINES = 120;
var table = (a, b) => {
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = rows[i] ?? [];
    const below = rows[i + 1] ?? [];
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return rows;
};
var walk = (a, b) => {
  const lcs = table(a, b);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left !== void 0 && left === right) {
      ops.push(["=", left]);
      i += 1;
      j += 1;
    } else if (right !== void 0 && (left === void 0 || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
      ops.push(["+", right]);
      j += 1;
    } else {
      ops.push(["-", left ?? ""]);
      i += 1;
    }
  }
  return ops;
};
var splitLines = (text2) => text2 === "" ? [] : text2.replace(/\r?\n$/, "").split(/\r?\n/);
var lineDiff = (path, before, after) => {
  const changes = walk(splitLines(before), splitLines(after)).filter(([op]) => op !== "=");
  if (changes.length === 0) return [];
  const lines = changes.map(([op, line]) => `${op} ${line}`);
  const shown = lines.slice(0, MAX_DIFF_LINES);
  const hidden = lines.length - shown.length;
  return [`--- ${path}`, `+++ ${path}`, ...shown, ...hidden > 0 ? [`… ${String(hidden)} more`] : []];
};

// src/install/report.ts
var jsonDetection = (detection) => ({
  gitRoot: detection.gitRoot,
  packageManager: detection.packageManager ?? null,
  languages: detection.languages,
  settings: detection.settings,
  authorities: detection.authorities,
  runner: detection.runner.kind,
  claudeVersion: detection.claude.version ?? null,
  failClosedHooks: detection.claude.failClosed
});
var authorityWarning = (t, authority) => ({
  code: `authority_${authority.kind}`,
  message: t(`install.warn.${authority.kind === "finitemonkey-plugin" ? "plugin" : "authority"}`, {
    name: authority.name,
    source: authority.source
  })
});
var itemWarning = (t, item) => {
  if (item.action === "skip-foreign")
    return [{ code: "foreign_file", message: t("install.warn.foreign", { path: item.path }) }];
  if (item.action === "keep-edited")
    return [{ code: "edited_file", message: t("install.warn.edited", { path: item.path }) }];
  return [];
};
var planWarnings = (t, plan) => [
  ...plan.detection.gitRoot ? [] : [{ code: "not_git", message: t("install.warn.not_git") }],
  ...plan.detection.claude.failClosed ? [] : [{ code: "fail_open", message: t("install.warn.fail_open", { version: plan.detection.claude.version ?? "?" }) }],
  ...plan.detection.authorities.map((authority) => authorityWarning(t, authority)),
  ...plan.items.flatMap((item) => itemWarning(t, item))
];
var planDiff = (plan) => plan.items.flatMap(
  (item) => item.action === "keep-edited" || item.action === "skip-foreign" ? lineDiff(item.path, item.before ?? "", item.proposal ?? item.after) : lineDiff(item.path, item.before ?? "", item.after)
);
var planData = (t, plan, mode, applied, backup) => ({
  schema: PLAN_SCHEMA,
  mode,
  applied,
  root: plan.detection.root,
  preset: plan.preset,
  detection: jsonDetection(plan.detection),
  actions: plan.items.map(({ path, action }) => ({ path, action })),
  warnings: planWarnings(t, plan),
  diff: planDiff(plan),
  ...backup === void 0 ? {} : { backup }
});
var pad2 = (text2, width) => text2.padEnd(width);
var planLines = (t, data, withDiff) => [
  t("install.plan.title", { root: data.root, preset: data.preset }),
  ...data.actions.map(({ path, action }) => `  ${pad2(action, 13)}${path}`),
  ...data.warnings.map(({ message }) => t("install.warning", { message })),
  ...withDiff ? data.diff : []
];

// src/install/project.ts
import { dirname as dirname3, join as join8 } from "node:path";
var projectAt = (root, runtime) => {
  const abs = (relative4) => toAbsolutePath(join8(root, ...relative4.split("/")));
  return {
    root,
    runtime,
    abs,
    read: (relative4) => {
      const text2 = runtime.readText(abs(relative4));
      return text2.ok ? text2.value : void 0;
    },
    exists: (relative4) => runtime.stat(abs(relative4)) !== void 0,
    isDir: (relative4) => runtime.stat(abs(relative4))?.kind === "dir"
  };
};
var findGitRoot = (start, runtime) => {
  let current = start;
  for (; ; ) {
    if (runtime.stat(toAbsolutePath(join8(current, ".git"))) !== void 0) return toAbsolutePath(current);
    const parent = dirname3(current);
    if (parent === current) return void 0;
    current = parent;
  }
};

// src/install/session.ts
var openProject = (ctx) => {
  const root = findGitRoot(ctx.cwd, ctx.runtime);
  return { project: projectAt(root ?? ctx.cwd, ctx.runtime), gitRoot: root !== void 0 };
};
var problem = (code, messageKey, fix, exitCode, params) => ({
  code,
  messageKey,
  params,
  fix,
  exitCode
});
var planProblem = (error) => error.kind === "settings" ? problem(
  "settings_unreadable",
  "error.settings_unreadable",
  "fix the JSON in .claude/settings.json, then run finitemonkey init again",
  ExitCode.NotConfigured,
  { detail: error.detail }
) : problem(
  "lock_unreadable",
  "error.lock_unreadable",
  "finitemonkey uninstall --purge --yes",
  ExitCode.NotConfigured,
  { detail: error.detail }
);
var applyProblem = (failure2) => failure2.detail.startsWith("locked:") ? problem(
  "install_locked",
  "error.install_locked",
  "wait for the other finitemonkey run to finish, then try again",
  ExitCode.CheckFailed,
  { path: failure2.path }
) : problem("install_failed", "error.install_failed", "finitemonkey doctor", ExitCode.NotConfigured, {
  path: failure2.path,
  detail: failure2.detail
});
var notInstalled = () => problem("not_installed", "error.not_installed", "finitemonkey init", ExitCode.NotConfigured, {});
var confirmProblem = (command, question, fix) => problem("needs_confirmation", "error.needs_confirmation", fix, ExitCode.NeedsPerson, { command, question });
var invalidPreset = (raw) => problem("invalid_arguments", "error.invalid_preset", "finitemonkey init --preset neutral", ExitCode.Usage, {
  preset: raw
});

// src/commands/init.ts
var flagsFor = (request, preset) => [
  `finitemonkey ${request.mode} --yes`,
  ...request.mode === "init" && preset !== "neutral" ? [`--preset ${preset}`] : [],
  ...request.bin === void 0 ? [] : [`--bin "${request.bin}"`],
  ...request.marketplace ? ["--marketplace"] : []
].join(" ");
var presentPlan = (ctx, request, plan) => {
  const data = planData(ctx.t, plan, request.mode, false, void 0);
  const human = planLines(ctx.t, data, request.showDiff || ctx.dryRun);
  if (ctx.dryRun) return success(data, [...human, ctx.t("install.dry_run")]);
  if (!hasChanges(plan)) return success(data, [...human, ctx.t("install.nothing_to_do")]);
  const next = flagsFor(request, plan.preset);
  const problem2 = confirmProblem(request.mode, ctx.t("install.confirm_question"), next);
  return { ...failureFrom(ctx.t, { ...problem2, data }, human), next };
};
var applyAndReport = (ctx, request, plan) => {
  const project = openProject(ctx).project;
  const applied = applyPlan(project, plan, ctx.version);
  if (!applied.ok) return failureFrom(ctx.t, applyProblem(applied.error));
  const data = planData(ctx.t, plan, request.mode, true, applied.value.backup);
  const done = ctx.t(request.mode === "init" ? "install.done_init" : "install.done_update");
  return success(data, [...planLines(ctx.t, data, request.showDiff), done]);
};
var runInstall = (ctx, request, presetFallback) => {
  const preset = request.preset === void 0 ? presetFallback : parsePreset(request.preset);
  if (preset === void 0) return failureFrom(ctx.t, invalidPreset(request.preset ?? ""));
  const { project, gitRoot } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  const input = {
    preset,
    lang: ctx.lang,
    bin: request.bin,
    version: ctx.version,
    marketplace: request.marketplace,
    env: ctx.env,
    t: ctx.t
  };
  const plan = buildPlan(project, detect(project, gitRoot, input), input, previous.value);
  if (!plan.ok) return failureFrom(ctx.t, planProblem(plan.error));
  if (ctx.dryRun || !ctx.yes || !hasChanges(plan.value)) return presentPlan(ctx, request, plan.value);
  return applyAndReport(ctx, request, plan.value);
};
var initRequest = (args) => ({
  mode: "init",
  preset: stringOption(args.values, "preset"),
  bin: stringOption(args.values, "bin"),
  marketplace: args.values["marketplace"] === true,
  showDiff: false
});
var initCommand = {
  path: ["init"],
  summaryKey: "command.init.summary",
  usage: "finitemonkey init [--preset neutral|gabriel] [--bin <path>] [--marketplace] [--dry-run] [--yes]",
  status: "ready",
  options: {
    preset: { type: "string" },
    bin: { type: "string" },
    github: { type: "boolean" },
    marketplace: { type: "boolean" }
  },
  run: (ctx, args) => Promise.resolve(runInstall(ctx, initRequest(args), "neutral"))
};

// src/install/uninstall.ts
var structural = (entry, current) => {
  if (entry.kind === "gitignore") {
    const text2 = withoutBlock(current);
    return text2 === "" && !entry.existed ? void 0 : text2;
  }
  const parsed = parseSettings(current);
  if (!parsed.ok || entry.added === void 0) return current;
  const settings = unmergeSettings(parsed.value, entry.added, entry.handlers ?? []);
  return Object.keys(settings).length === 0 && !entry.existed ? void 0 : renderJson(settings, styleOf(current));
};
var unchanged = (project, entry) => {
  if (!entry.existed) return { path: entry.path, action: "delete", after: void 0 };
  const original = entry.backup === void 0 ? void 0 : project.read(entry.backup);
  return original === void 0 ? void 0 : { path: entry.path, action: "restore", after: original };
};
var removalFor = (project, entry, options) => {
  const current = project.read(entry.path);
  if (current === void 0) return { path: entry.path, action: "gone", after: void 0 };
  if (entry.kind === "generated" && options.keepGenerated) {
    return { path: entry.path, action: "keep-generated", after: current };
  }
  if (hashText(current) === entry.hash) {
    const exact2 = unchanged(project, entry);
    if (exact2 !== void 0) return exact2;
  }
  if (entry.kind === "generated") return { path: entry.path, action: "keep-edited", after: current };
  const after = structural(entry, current);
  return { path: entry.path, action: after === void 0 ? "delete" : "unmerge", after };
};
var planRemoval = (project, lock, options) => ({
  items: lock.entries.map((entry) => removalFor(project, entry, options)),
  purge: options.purge,
  removeDirs: lock.createdDirs.filter((dir) => dir !== STATE_DIR)
});
var applyItem = (project, item) => {
  if (item.action === "delete") {
    const removed = project.runtime.remove(project.abs(item.path));
    return removed.ok ? removed : reject({ path: item.path, detail: removed.error });
  }
  if (item.after === void 0 || item.action === "gone" || item.action.startsWith("keep")) return accept(void 0);
  return writeText(project, item.path, item.after);
};
var isEmptyDir = (project, relative4) => {
  const listed2 = project.runtime.listDir(project.abs(relative4));
  return listed2.ok && listed2.value.length === 0;
};
var finish = (project, plan) => {
  const target = plan.purge ? STATE_DIR : LOCK_FILE;
  const removed = project.runtime.remove(project.abs(target));
  if (!removed.ok) return reject({ path: target, detail: removed.error });
  for (const dir of plan.removeDirs) if (isEmptyDir(project, dir)) project.runtime.remove(project.abs(dir));
  return accept(void 0);
};
var applyRemoval = (project, plan) => {
  const changed = withInstallLock(project, () => {
    for (const item of plan.items) {
      const done = applyItem(project, item);
      if (!done.ok) return done;
    }
    return accept(void 0);
  });
  return changed.ok ? finish(project, plan) : changed;
};

// src/commands/uninstall.ts
var UNINSTALL_SCHEMA = "finitemonkey/uninstall-plan@1";
var OUTSIDE = ["claude plugin uninstall finitemonkey@finitemonkey"];
var dataOf2 = (root, plan, applied) => ({
  schema: UNINSTALL_SCHEMA,
  applied,
  purge: plan.purge,
  root,
  actions: plan.items.map(({ path, action }) => ({ path, action })),
  kept: plan.items.filter((item) => item.action.startsWith("keep")).map(({ path }) => path),
  outside: OUTSIDE
});
var linesOf = (ctx, data) => [
  ctx.t("install.uninstall.title", { root: data.root }),
  ...data.actions.map(({ path, action }) => `  ${action.padEnd(15)}${path}`),
  ...data.purge ? [ctx.t("install.uninstall.purge")] : [ctx.t("install.uninstall.keeps_state")],
  ...data.kept.map((path) => ctx.t("install.warn.edited_kept", { path })),
  ctx.t("install.uninstall.outside", { command: OUTSIDE.join(", ") })
];
var fixFor = (args) => [
  "finitemonkey uninstall --yes",
  ...args.values["purge"] === true ? ["--purge"] : [],
  ...args.values["keep-generated"] === true ? ["--keep-generated"] : []
].join(" ");
var runUninstall = (ctx, args) => {
  const { project } = openProject(ctx);
  const lock = readPreviousLock(project);
  if (!lock.ok) return failureFrom(ctx.t, planProblem(lock.error));
  if (lock.value === void 0) return failureFrom(ctx.t, notInstalled());
  const options = { purge: args.values["purge"] === true, keepGenerated: args.values["keep-generated"] === true };
  const plan = planRemoval(project, lock.value, options);
  const preview = dataOf2(project.root, plan, false);
  if (ctx.dryRun) return success(preview, [...linesOf(ctx, preview), ctx.t("install.dry_run")]);
  if (!ctx.yes) {
    const next = fixFor(args);
    const problem2 = confirmProblem("uninstall", ctx.t("install.uninstall.question"), next);
    return { ...failureFrom(ctx.t, { ...problem2, data: preview }, linesOf(ctx, preview)), next };
  }
  const removed = applyRemoval(project, plan);
  if (!removed.ok) return failureFrom(ctx.t, applyProblem(removed.error));
  const data = dataOf2(project.root, plan, true);
  return success(data, [...linesOf(ctx, data), ctx.t("install.uninstall.done")]);
};
var uninstallCommand = {
  path: ["uninstall"],
  summaryKey: "command.uninstall.summary",
  usage: "finitemonkey uninstall [--purge] [--keep-generated] [--dry-run] [--yes]",
  status: "ready",
  options: { purge: { type: "boolean" }, "keep-generated": { type: "boolean" } },
  run: (ctx, args) => Promise.resolve(runUninstall(ctx, args))
};

// src/commands/update.ts
var check = (ctx, bin) => {
  const { project, gitRoot } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  if (previous.value === void 0) return failureFrom(ctx.t, notInstalled());
  const input = {
    preset: previous.value.preset,
    lang: ctx.lang,
    bin,
    version: ctx.version,
    marketplace: false,
    env: ctx.env,
    t: ctx.t
  };
  const plan = buildPlan(project, detect(project, gitRoot, input), input, previous.value);
  if (!plan.ok) return failureFrom(ctx.t, planProblem(plan.error));
  const data = planData(ctx.t, plan.value, "update", false, void 0);
  const human = planLines(ctx.t, data, true);
  if (!hasChanges(plan.value)) return success(data, [...human, ctx.t("install.up_to_date")]);
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human,
    error: { code: "install_outdated", message: ctx.t("error.install_outdated"), fix: "finitemonkey update --yes" }
  };
};
var runUpdate = (ctx, args) => {
  const bin = stringOption(args.values, "bin");
  if (args.values["check"] === true) return check(ctx, bin);
  const { project } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  if (previous.value === void 0) return failureFrom(ctx.t, notInstalled());
  const preset = stringOption(args.values, "preset");
  const request = { mode: "update", preset, bin, marketplace: false, showDiff: true };
  return runInstall(ctx, request, previous.value.preset);
};
var updateCommand = {
  path: ["update"],
  summaryKey: "command.update.summary",
  usage: "finitemonkey update [--check] [--preset neutral|gabriel] [--bin <path>] [--yes]",
  status: "ready",
  options: { check: { type: "boolean" }, preset: { type: "string" }, bin: { type: "string" } },
  run: (ctx, args) => Promise.resolve(runUpdate(ctx, args))
};

// src/commands/version.ts
var versionCommand = {
  path: ["version"],
  summaryKey: "command.version.summary",
  usage: "finitemonkey version",
  status: "ready",
  run: (ctx) => {
    const data = { version: ctx.version, node: ctx.runtime.nodeVersion, platform: ctx.platform };
    return Promise.resolve(success(data, [ctx.version]));
  }
};

// src/commands/index.ts
var REGISTRY = [
  initCommand,
  doctorCommand,
  updateCommand,
  uninstallCommand,
  i18nCheckCommand,
  hookCommand,
  secretsScanCommand,
  secretsAcceptCommand,
  secretsIncidentCommand,
  versionCommand,
  helpCommand
];

// src/core/suggest.ts
var distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
};
var closest = (input, candidates) => {
  const group = candidates.find((name) => name.startsWith(`${input} `));
  if (group !== void 0) return group;
  const limit = Math.max(1, Math.floor(input.length / 3));
  let best;
  for (const name of candidates) {
    const score = distance(input, name.split(" ")[0] ?? name);
    if (score <= limit && (best === void 0 || score < best.score)) best = { name, score };
  }
  return best?.name;
};

// src/core/dispatch.ts
var unknownCommand = (registry, attempted) => {
  const suggestion = closest(attempted, registry.map(commandName));
  return suggestion === void 0 ? usageProblem("unknown_command", "error.unknown_command", "finitemonkey help", { command: attempted }) : usageProblem("unknown_command", "error.unknown_command_suggest", `finitemonkey ${suggestion}`, {
    command: attempted,
    suggestion
  });
};
var failWith = (ctx, name, problem2) => ({
  name,
  execute: () => Promise.resolve(failureFrom(ctx.t, problem2))
});
var invoke = (ctx, argv, spec, registry) => {
  const name = commandName(spec);
  const args = strictArgs(argv, spec);
  if (!args.ok) return failWith(ctx, name, args.error);
  return { name, execute: () => spec.run(ctx, args.value, registry) };
};
var builtin = (registry, name) => registry.find((spec) => commandName(spec) === name);
var dispatch = (ctx, argv, loose, registry) => {
  const resolved = resolveCommand(registry, loose.positionals);
  const attempted = loose.positionals[0];
  if (resolved === void 0 && attempted !== void 0) {
    return failWith(ctx, attempted, unknownCommand(registry, attempted));
  }
  const wanted = loose.version && !loose.help ? "version" : "help";
  if (resolved === void 0 || loose.version && !loose.help) {
    const spec = builtin(registry, wanted);
    if (spec === void 0) return failWith(ctx, wanted, unknownCommand(registry, wanted));
    return { name: wanted, execute: () => spec.run(ctx, { values: {}, positionals: [] }, registry) };
  }
  if (loose.help) return { name: "help", execute: () => Promise.resolve(helpFor(ctx, resolved.spec)) };
  return invoke(ctx, argv, resolved.spec, registry);
};

// src/core/output.ts
var ISSUES_URL = "https://github.com/gabrielvieiraf/finitemonkey/issues";
var resultFromThrown = (thrown, t) => {
  if (thrown instanceof FmError) return failureFrom(t, thrown.problem);
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return failureFrom(t, {
    code: "internal_error",
    messageKey: "error.internal",
    params: { detail },
    fix: ISSUES_URL,
    exitCode: ExitCode.Internal
  });
};
var block = (items) => items.length > 0 ? `${items.join("\n")}
` : "";
var write = (sink, text2) => {
  if (text2 !== "") sink.write(maskText(text2));
};
var render = (ctx, command, result) => {
  if (result.raw !== void 0) {
    write(ctx.io.stdout, result.raw.stdout);
    write(ctx.io.stderr, result.raw.stderr);
    return;
  }
  if (ctx.json) {
    ctx.io.stdout.write(`${JSON.stringify(maskDeep(toEnvelope(command, result)))}
`);
    return;
  }
  write(ctx.io.stdout, block(result.human ?? []));
  if (!result.ok) {
    const { message, fix } = result.error;
    write(ctx.io.stderr, block([ctx.t("output.error", { message }), ctx.t("output.fix", { fix })]));
  }
  if (result.next !== void 0) write(ctx.io.stdout, block([ctx.t("output.next", { next: result.next })]));
};

// src/core/run.ts
var run = async (options) => {
  const loose = looseArgs(options.argv);
  const detected = detectLang(loose.lang, options.env);
  const t = createTranslator(detected.lang);
  const ctx = {
    lang: detected.lang,
    langSource: detected.source,
    t,
    json: loose.json,
    yes: loose.yes,
    dryRun: loose.dryRun,
    cwd: options.cwd,
    env: options.env,
    platform: options.platform,
    version: options.version,
    io: options.io,
    runtime: options.runtime
  };
  let name = loose.positionals[0] ?? "";
  let result;
  try {
    if (loose.lang !== void 0 && normalizeLang(loose.lang) === void 0) {
      const problem2 = usageProblem("invalid_lang", "error.invalid_lang", "finitemonkey --lang en", {
        lang: loose.lang,
        languages: LANGUAGES.join(", ")
      });
      result = failureFrom(t, problem2);
    } else {
      const dispatched = dispatch(ctx, options.argv, loose, options.registry ?? REGISTRY);
      name = dispatched.name;
      result = await dispatched.execute();
    }
  } catch (thrown) {
    result = resultFromThrown(thrown, t);
  }
  render(ctx, name, result);
  return result.exitCode;
};

// src/core/version.ts
import { fileURLToPath as fileURLToPath3 } from "node:url";
var UNKNOWN_VERSION = "0.0.0-unknown";
var readPackageVersion = (readText, moduleUrl) => {
  const text2 = readText(toAbsolutePath(fileURLToPath3(new URL("../package.json", moduleUrl))));
  if (!text2.ok) return UNKNOWN_VERSION;
  const parsed = parseJson(text2.value);
  if (!parsed.ok || !isRecord(parsed.value)) return UNKNOWN_VERSION;
  const version = parsed.value["version"];
  return typeof version === "string" ? version : UNKNOWN_VERSION;
};

// src/cli.ts
var flush = (stream) => new Promise((resolve2) => {
  stream.write("", () => {
    resolve2();
  });
});
var main = async () => {
  const runtime = nodeRuntime();
  const code = await run({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: toAbsolutePath(process.cwd()),
    platform: process.platform,
    io: { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin },
    version: readPackageVersion(runtime.readText, import.meta.url),
    runtime
  });
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
};
if (isEntryPoint(import.meta.url, process.argv[1], nodeRealpath, process.platform)) await main();
export {
  main
};
